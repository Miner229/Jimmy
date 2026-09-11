import { one, audit } from "./db.js";
import { financeNotification, syncAccount } from "./clubs.js";
import { syncBanks } from "./webhooks.js";
export async function sendEmails(db) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    return { email: "not_configured" };
  const rows = (
    await db.query(
      "select * from email_outbox where sent_at is null order by created_at limit 20 for update skip locked",
    )
  ).rows;
  for (const mail of rows) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.id,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: mail.recipient,
        subject: mail.subject,
        text: mail.body,
      }),
    });
    await db.query(
      "update email_outbox set attempts=attempts+1,sent_at=case when $1 then now() else null end,body=case when $1 then '[Delivered]' else body end where id=$2",
      [response.ok, mail.id],
    );
  }
  return { processed: rows.length };
}
export async function releaseHolds(db, provider) {
  const changes = (
    await db.query(
      "select * from payout_changes where status='holding' and hold_until<now() for update skip locked",
    )
  ).rows;
  let released = 0;
  for (const c of changes) {
    const risk = await one(
      db,
      "select id from risk_flags where club_id=$1 and status='review'",
      [c.club_id],
    );
    if (risk) continue;
    const a = await one(
      db,
      "select * from payment_accounts where id=$1 for update",
      [c.payment_account_id],
    );
    const banks = await provider.banks(a.provider_account_id);
    const bank = banks.find(
      (b) =>
        b.id === c.new_reference &&
        b.default_for_currency &&
        b.currency === "gbp" &&
        ["validated", "verified"].includes(b.status),
    );
    if (!bank) continue;
    const remote = await provider.account(a.provider_account_id);
    if (!remote.payouts_enabled) continue;
    await provider.resume(a.provider_account_id, `resume-${c.id}`);
    await db.query(
      "update payout_changes set status='completed',completed_at=now() where id=$1",
      [c.id],
    );
    await syncBanks(db, provider, a);
    await syncAccount(db, provider, a);
    await audit(db, null, c.club_id, "payout.change_completed", c.id);
    await financeNotification(
      db,
      c.club_id,
      "Jimmi payout change completed",
      "Your payout security hold has ended. Automatic payouts to the verified destination have resumed.",
    );
    released++;
  }
  return { released };
}

// Complete refunds if a payment succeeds after a Club cancelled its Session.
// Intent persistence is deliberately outside the provider call transaction.
export async function reconcileCancelledSessions(transact, provider) {
  const { refundBooking, finishRefund } = await import("./payments.js");
  const work = await transact(
    async (db) =>
      (
        await db.query(
          `select b.id,m.user_id from bookings b join sessions s on s.id=b.session_id join club_memberships m on m.club_id=b.club_id and m.role='Owner' and m.status='active' where s.status='cancelled' and b.status='confirmed' limit 25`,
        )
      ).rows,
  );
  let completed = 0;
  for (const item of work) {
    try {
      const prepared = await transact(async (db) => {
        const owner = await one(db, "select * from users where id=$1", [
          item.user_id,
        ]);
        const r = await refundBooking(
          db,
          owner,
          {
            booking_id: item.id,
            reason: "Automatic refund under Club Session cancellation policy",
          },
          provider,
          false,
          true,
        );
        await audit(
          db,
          null,
          r.pendingRefund?.payment.club_id || null,
          "refund.cancellation_reconciliation",
          item.id,
          { authority: "Club cancellation policy" },
        );
        return r;
      });
      if (prepared.pendingRefund)
        await transact((db) =>
          finishRefund(db, provider, prepared.pendingRefund),
        );
      completed++;
    } catch {
      /* Keep confirmed booking visible for retry and finance review. */
    }
  }
  return { cancellation_refunds: completed };
}
