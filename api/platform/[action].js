import { authenticate, authClient } from "../../server/auth.js";
import {
  database,
  transaction,
  one,
  uuid,
  token,
  hash,
  rateLimit,
  audit,
} from "../../server/db.js";
import { HttpError, requireVerified, text } from "../../server/domain.js";
import { PaymentProviderService } from "../../server/payment-provider.js";
import {
  createClub,
  invite,
  acceptInvite,
  mutateMember,
  membership,
  saveSession,
  startOnboarding,
  syncAccount,
  email,
} from "../../server/clubs.js";
import {
  checkout,
  finishCheckout,
  refundBooking,
  finishRefund,
  payoutChange,
} from "../../server/payments.js";
import { reviewRisks } from "../../server/risk.js";
import {
  sendEmails,
  releaseHolds,
  reconcileCancelledSessions,
} from "../../server/jobs.js";
const provider = () => new PaymentProviderService();
const getActions = new Set([
  "catalog",
  "me",
  "dashboard",
  "bookings",
  "finance",
]);
export async function dispatch(action, req, input) {
  if (action === "catalog") {
    const db = database();
    return {
      clubs: (
        await db.query(
          "select id,name,primary_sport,main_area from clubs where status='active' order by created_at desc limit 200",
        )
      ).rows,
      sessions: (
        await db.query(
          "select s.id,s.club_id,s.title,s.venue,s.starts_at,s.ends_at,s.price,s.capacity,s.cancellation_hours,jsonb_build_object('kind',s.details->>'kind','courts',s.details->>'courts','description',s.details->>'description') as details,c.name as club_name,(select count(*)::int from bookings b where b.session_id=s.id and b.status in ('confirmed','pending')) as going from sessions s join clubs c on c.id=s.club_id where s.status='published' and c.status='active' and s.starts_at>now() and coalesce(s.details->>'visibility','Public')='Public' order by s.starts_at limit 200",
        )
      ).rows,
    };
  }
  if (action === "jobs") {
    if (
      !process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
    )
      throw new HttpError(401, "Unauthorized");
    const result = await transaction(async (db) => ({
      ...(await sendEmails(db)),
      ...(await reviewRisks(db)),
      ...(process.env.STRIPE_SECRET_KEY
        ? await releaseHolds(db, provider())
        : {}),
    }));
    if (process.env.STRIPE_SECRET_KEY)
      Object.assign(
        result,
        await reconcileCancelledSessions(transaction, provider()),
      );
    return result;
  }
  if (
    action === "payout-change" &&
    (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  )
    throw new HttpError(
      503,
      "Configure security notification email delivery before changing payout details.",
    );
  const user = await authenticate(req);
  if (action === "me")
    return {
      user,
      memberships: (
        await database().query(
          "select m.*,c.name,c.payment_entity_type from club_memberships m join clubs c on c.id=m.club_id where m.user_id=$1 and m.status='active' and c.status='active'",
          [user.id],
        )
      ).rows,
    };
  requireVerified(user);
  if (req.method !== "GET") await rateLimit(`mutation:${user.id}`, 60);
  if (action === "step-up") {
    await rateLimit(`stepup:${user.id}`, 5);
    return transaction(async (db) => {
      await membership(db, user, input.club_id, "payoutChange");
      const { data, error } = await authClient().auth.signInWithPassword({
        email: user.email,
        password: input.password || "",
      });
      if (error || data.user?.id !== user.id)
        throw new HttpError(403, "Password confirmation failed.");
      const secret = token();
      await db.query(
        "insert into step_up_tokens(token_hash,user_id,club_id,expires_at) values($1,$2,$3,now()+interval '5 minutes')",
        [hash(secret), user.id, input.club_id],
      );
      return { token: secret };
    });
  }
  // Commit reservation/refund intent BEFORE contacting Stripe. Retries use the
  // persisted ID, including when the provider succeeds but the response is lost.
  if (action === "checkout") {
    const p = process.env.STRIPE_SECRET_KEY ? provider() : null;
    const prepared = await transaction((db) =>
      checkout(db, user, input, p, true),
    );
    if (!prepared.pendingCheckout) return prepared;
    return finishCheckout(database(), p, prepared.pendingCheckout);
  }
  if (action === "refund" || action === "cancel-booking") {
    const p = process.env.STRIPE_SECRET_KEY ? provider() : null;
    const prepared = await transaction((db) =>
      refundBooking(db, user, input, p, action === "cancel-booking", true),
    );
    if (!prepared.pendingRefund) return prepared;
    return transaction((db) => finishRefund(db, p, prepared.pendingRefund));
  }
  if (action === "cancel-session") {
    const rows = await transaction(async (db) => {
      const session = await one(db, "select * from sessions where id=$1", [
        input.session_id,
      ]);
      if (!session) throw new HttpError(404, "Session not found.");
      await membership(db, user, session.club_id, "refund");
      await db.query("update sessions set status='cancelled' where id=$1", [
        session.id,
      ]);
      await audit(db, user, session.club_id, "session.cancelled", session.id);
      return (
        await db.query(
          "select id from bookings where session_id=$1 and status='confirmed'",
          [session.id],
        )
      ).rows;
    });
    const failed = [];
    for (const b of rows) {
      try {
        const p = process.env.STRIPE_SECRET_KEY ? provider() : null;
        const prepared = await transaction((db) =>
          refundBooking(
            db,
            user,
            { booking_id: b.id, reason: "Session cancelled by Club" },
            p,
            false,
            true,
          ),
        );
        if (prepared.pendingRefund)
          await transaction((db) =>
            finishRefund(db, p, prepared.pendingRefund),
          );
      } catch {
        failed.push(b.id);
      }
    }
    return {
      ok: true,
      pending_refunds: failed,
      message: failed.length
        ? "Session cancelled. Some refunds require retry in Finance."
        : "Session cancelled and confirmed bookings refunded/cancelled.",
    };
  }
  return transaction(async (db) => {
    switch (action) {
      case "clubs":
        return createClub(db, user, input);
      case "invite":
        return invite(db, user, input);
      case "accept-invitation":
        return acceptInvite(db, user, input.token);
      case "members":
        return mutateMember(db, user, input);
      case "revoke-invitation": {
        const m = await membership(db, user, input.club_id, "invite");
        const i = await one(
          db,
          "select * from club_invitations where id=$1 and club_id=$2 for update",
          [input.id, input.club_id],
        );
        if (
          !i ||
          (m.role === "Admin" &&
            (i.intended_role !== "Organizer" ||
              i.invited_by_user_id !== user.id))
        )
          throw new HttpError(403, "Cannot revoke this invitation.");
        await db.query(
          "update club_invitations set revoked_at=now() where id=$1",
          [i.id],
        );
        await audit(db, user, input.club_id, "invitation.revoked", i.id);
        return { ok: true };
      }
      case "sessions": {
        const entries = input.entries || [input];
        if (!Array.isArray(entries) || !entries.length || entries.length > 20)
          throw new HttpError(400, "Choose between 1 and 20 Session dates.");
        const result = [];
        for (const entry of entries)
          result.push(
            await saveSession(
              db,
              user,
              entry,
              entry.publish &&
                Number(entry.price) > 0 &&
                process.env.STRIPE_SECRET_KEY
                ? provider()
                : null,
            ),
          );
        return { sessions: result, id: result[0].id };
      }
      case "onboarding":
        return startOnboarding(db, user, input, provider());
      case "payout-change":
        return payoutChange(db, user, input, provider());

      case "bookings":
        return {
          bookings: (
            await db.query(
              "select b.*,s.title,s.starts_at,s.ends_at,s.price,s.venue,c.name as club_name,t.payment_status,t.refund_status from bookings b join sessions s on s.id=b.session_id join clubs c on c.id=b.club_id left join booking_transactions t on t.booking_id=b.id where b.user_id=$1 order by b.created_at desc limit 200",
              [user.id],
            )
          ).rows,
        };
      case "dashboard": {
        const m = await membership(db, user, input.club_id, "createSession");
        const club = await one(db, "select * from clubs where id=$1", [
          input.club_id,
        ]);
        return {
          club,
          role: m.role,
          sessions: (
            await db.query(
              "select * from sessions where club_id=$1 and status!='deleted' and ($2!='Organizer' or organizer_user_id=$3) order by starts_at desc",
              [club.id, m.role, user.id],
            )
          ).rows,
          members:
            m.role === "Organizer"
              ? []
              : (
                  await db.query(
                    "select m.id,m.user_id,m.role,m.status,u.full_name,u.email from club_memberships m join users u on u.id=m.user_id where club_id=$1",
                    [club.id],
                  )
                ).rows,
          invitations:
            m.role === "Organizer"
              ? []
              : (
                  await db.query(
                    "select id,email,intended_role,expires_at,accepted_at,revoked_at from club_invitations where club_id=$1",
                    [club.id],
                  )
                ).rows,
        };
      }
      case "finance": {
        await membership(db, user, input.club_id, "viewFinance");
        let account = await one(
          db,
          "select * from payment_accounts where club_id=$1 and active for update",
          [input.club_id],
        );
        let balance = null;
        if (account?.provider_account_id) {
          account = await syncAccount(db, provider(), account);
          balance = await provider().balance(account.provider_account_id);
        }
        return {
          account,
          balance,
          destination: account
            ? await one(
                db,
                "select bank_display_name,last4,status from payout_destinations where payment_account_id=$1 and active",
                [account.id],
              )
            : null,
          transactions: (
            await db.query(
              "select * from booking_transactions where club_id=$1 order by created_at desc limit 100",
              [input.club_id],
            )
          ).rows,
          payouts: (
            await db.query(
              "select * from payouts where club_id=$1 order by updated_at desc limit 50",
              [input.club_id],
            )
          ).rows,
          risks: (
            await db.query(
              "select signal,status,created_at from risk_flags where club_id=$1",
              [input.club_id],
            )
          ).rows,
          changes: (
            await db.query(
              "select status,hold_until from payout_changes where club_id=$1 and status!='completed'",
              [input.club_id],
            )
          ).rows,
        };
      }
      case "participants": {
        const s = await one(db, "select * from sessions where id=$1", [
          input.session_id,
        ]);
        if (!s) throw new HttpError(404, "Session not found.");
        await membership(db, user, s.club_id, "viewBookings", s);
        return {
          participants: (
            await db.query(
              "select b.id,b.status,b.attended,u.full_name from bookings b join users u on u.id=b.user_id where b.session_id=$1",
              [s.id],
            )
          ).rows,
        };
      }
      case "attendance": {
        const s = await one(db, "select * from sessions where id=$1", [
          input.session_id,
        ]);
        if (!s) throw new HttpError(404, "Session not found.");
        await membership(db, user, s.club_id, "attendance", s);
        await db.query(
          "update bookings set attended=$1 where id=$2 and session_id=$3 and status='confirmed'",
          [input.attended === true, input.booking_id, s.id],
        );
        await audit(
          db,
          user,
          s.club_id,
          "attendance.updated",
          input.booking_id,
        );
        return { ok: true };
      }
      case "delete-session": {
        const s = await one(db, "select * from sessions where id=$1", [
          input.session_id,
        ]);
        if (!s) throw new HttpError(404, "Session not found.");
        await membership(db, user, s.club_id, "deleteSession", s);
        if (s.status !== "draft")
          throw new HttpError(
            409,
            "Only drafts can be deleted. Cancel published Sessions instead.",
          );
        await db.query("update sessions set status='deleted' where id=$1", [
          s.id,
        ]);
        await audit(db, user, s.club_id, "session.deleted", s.id);
        return { ok: true };
      }
      case "message-participants": {
        const session = await one(db, "select * from sessions where id=$1", [
          input.session_id,
        ]);
        if (!session) throw new HttpError(404, "Session not found.");
        await membership(db, user, session.club_id, "viewBookings", session);
        const message = text(input.message, "message", 3000);
        const recipients = (
          await db.query(
            "select u.email from bookings b join users u on u.id=b.user_id where b.session_id=$1 and b.status='confirmed'",
            [session.id],
          )
        ).rows;
        for (const recipient of recipients)
          await email(
            db,
            recipient.email,
            `Jimmi Session update: ${session.title}`,
            message,
          );
        await audit(
          db,
          user,
          session.club_id,
          "session.participants_messaged",
          session.id,
          { recipients: recipients.length },
        );
        return {
          message: `Message queued for ${recipients.length} confirmed participants.`,
        };
      }
      case "edit-session-details": {
        const session = await one(db, "select * from sessions where id=$1", [
          input.session_id,
        ]);
        if (!session) throw new HttpError(404, "Session not found.");
        await membership(db, user, session.club_id, "editSession", session);
        const description = text(input.description, "description", 5000);
        await db.query(
          "update sessions set details=jsonb_set(details,'{description}',to_jsonb($1::text)) where id=$2",
          [description, session.id],
        );
        await audit(db, user, session.club_id, "session.updated", session.id);
        return { ok: true };
      }
      case "edit-club": {
        await membership(db, user, input.club_id, "editClub");
        await db.query("update clubs set name=$1,main_area=$2 where id=$3", [
          text(input.name, "Club name", 120),
          text(input.main_area, "area", 120),
          input.club_id,
        ]);
        await audit(db, user, input.club_id, "club.updated", input.club_id);
        return { ok: true };
      }
      case "archive": {
        await membership(db, user, input.club_id, "archive");
        const live = await one(
          db,
          "select id from sessions where club_id=$1 and status='published' and ends_at>now() limit 1",
          [input.club_id],
        );
        if (live)
          throw new HttpError(
            409,
            "Cancel or finish published Sessions before archiving the Club.",
          );
        const account = await one(
          db,
          "select id from payment_accounts where club_id=$1 and active",
          [input.club_id],
        );
        if (account)
          throw new HttpError(
            409,
            "Payment account closure requires support review of outstanding funds, refunds and disputes.",
          );
        await db.query("update clubs set status='archived' where id=$1", [
          input.club_id,
        ]);
        await audit(db, user, input.club_id, "club.archived", input.club_id);
        return { ok: true };
      }
      default:
        throw new HttpError(404, "Unknown action");
    }
  });
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = req.query.action;
  const method = getActions.has(action) || action === "jobs" ? "GET" : "POST";
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    if (
      req.method === "POST" &&
      req.headers.origin &&
      req.headers.origin !== process.env.APP_ORIGIN
    )
      throw new HttpError(403, "Invalid request origin.");
    const input =
      req.method === "GET"
        ? req.query
        : (typeof req.body === "string" ? JSON.parse(req.body) : req.body) ||
          {};
    if (req.method === "POST" && JSON.stringify(input).length > 64000)
      throw new HttpError(413, "Request is too large.");
    const result = await dispatch(action, req, input);
    if (["invite", "payout-change", "message-participants"].includes(action)) {
      try {
        await transaction((db) => sendEmails(db));
      } catch {
        console.error("Email delivery deferred to scheduled retry");
      }
    }
    return res.status(200).json(result);
  } catch (e) {
    const status = e.status || (e.code === "22P02" ? 400 : 500);
    if (status === 500)
      console.error("platform action failed", action, e.code || e.name);
    return res.status(status).json({
      error: e.status
        ? e.message
        : status === 400
          ? "Invalid identifier or value."
          : "Unable to complete this action. Please try again.",
      code: e.status ? e.code : undefined,
    });
  }
}
