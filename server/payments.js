import { one, uuid, audit, hash } from "./db.js";
import { requireVerified, HttpError, assertPublish, text } from "./domain.js";
import { membership, syncAccount, financeNotification } from "./clubs.js";
export async function checkout(
  db,
  user,
  input,
  provider,
  deferProvider = false,
) {
  requireVerified(user);
  const session = await one(
    db,
    "select s.* from sessions s join clubs c on c.id=s.club_id where s.id=$1 and s.status='published' and c.status='active' for update of s",
    [input.session_id],
  );
  if (!session || new Date(session.starts_at) <= new Date())
    throw new HttpError(409, "This Session is not available for booking.");
  // Expired reservations are released by the signed checkout.session.expired
  // event, never by the client clock, to avoid overselling paid reservations.
  const existing = await one(
    db,
    "select * from bookings where session_id=$1 and user_id=$2 and status in ('pending','confirmed')",
    [session.id, user.id],
  );
  if (existing?.status === "confirmed")
    return { id: existing.id, status: "confirmed" };
  const count = await one(
    db,
    "select count(*)::int as n from bookings where session_id=$1 and status in ('pending','confirmed')",
    [session.id],
  );
  if (!existing && count.n >= session.capacity)
    throw new HttpError(409, "This Session is full.");
  let account;
  if (session.price > 0) {
    account = await one(
      db,
      "select * from payment_accounts where club_id=$1 and active for update",
      [session.club_id],
    );
    if (account?.provider_account_id)
      account = await syncAccount(db, provider, account);
    assertPublish(session, account);
  }
  if (existing?.checkout_url)
    return { id: existing.id, url: existing.checkout_url };
  const booking =
    existing ||
    (await one(
      db,
      "insert into bookings(id,club_id,session_id,user_id,status,expires_at) values($1,$2,$3,$4,$5,now()+interval '35 minutes') returning *",
      [
        uuid(),
        session.club_id,
        session.id,
        user.id,
        session.price ? "pending" : "confirmed",
      ],
    ));
  if (!session.price) return { id: booking.id, status: "confirmed" };
  const bps = Number(process.env.PLATFORM_FEE_BPS || 500);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new HttpError(503, "Invalid platform fee configuration.");
  const fee = Math.round((session.price * bps) / 10000);
  await db.query(
    "insert into booking_transactions(id,club_id,session_id,booking_id,payment_account_id,gross_amount,platform_fee) values($1,$2,$3,$4,$5,$6,$7) on conflict(booking_id) do nothing",
    [
      uuid(),
      session.club_id,
      session.id,
      booking.id,
      account.id,
      session.price,
      fee,
    ],
  );
  if (deferProvider)
    return { pendingCheckout: { account, session, booking, fee } };
  return finishCheckout(db, provider, { account, session, booking, fee });
}
export async function finishCheckout(
  db,
  provider,
  { account, session, booking, fee },
) {
  if (!provider) throw new HttpError(503, "Payments are not configured yet.");
  const result = await provider.checkout(account, session, booking, fee);
  await db.query(
    "update bookings set checkout_id=$1,checkout_url=$2 where id=$3",
    [result.id, result.url, booking.id],
  );
  return { id: booking.id, url: result.url };
}

export async function refundBooking(
  db,
  user,
  input,
  provider,
  playerCancellation = false,
  deferProvider = false,
) {
  const b = await one(
    db,
    "select b.*,s.starts_at,s.cancellation_hours from bookings b join sessions s on s.id=b.session_id where b.id=$1",
    [input.booking_id],
  );
  if (!b) throw new HttpError(404, "Booking not found.");
  if (playerCancellation) {
    requireVerified(user);
    if (b.user_id !== user.id)
      throw new HttpError(403, "This booking belongs to another player.");
    if (
      b.cancellation_hours === -1 ||
      Date.now() >
        new Date(b.starts_at).getTime() - b.cancellation_hours * 3600000
    )
      throw new HttpError(
        409,
        "The cancellation deadline has passed. Contact the Club.",
      );
  } else await membership(db, user, b.club_id, "refund");
  await db.query("select id from bookings where id=$1 for update", [b.id]);
  const payment = await one(
    db,
    "select * from booking_transactions where booking_id=$1 for update",
    [b.id],
  );
  if (!payment) {
    if (b.status !== "confirmed")
      throw new HttpError(409, "This booking cannot be cancelled.");
    await db.query("update bookings set status='cancelled' where id=$1", [
      b.id,
    ]);
    await audit(db, user, b.club_id, "booking.cancelled", b.id);
    return { ok: true };
  }
  if (
    payment.payment_status !== "succeeded" ||
    (payment.dispute_status !== "none" && payment.dispute_status !== "won")
  )
    throw new HttpError(
      409,
      "Only successful, undisputed payments can be refunded.",
    );
  const reason = text(
    input.reason || "Player cancellation",
    "refund reason",
    500,
  );
  let refund = await one(
    db,
    "select * from refunds where transaction_id=$1 and status not in ('failed','canceled')",
    [payment.id],
  );
  if (refund?.provider_refund_id)
    return { id: refund.id, status: refund.status };
  if (!refund)
    refund = await one(
      db,
      "insert into refunds(id,transaction_id,actor_user_id,amount,reason) values($1,$2,$3,$4,$5) returning *",
      [uuid(), payment.id, user.id, payment.gross_amount, reason],
    );
  const account = await one(db, "select * from payment_accounts where id=$1", [
    payment.payment_account_id,
  ]);
  if (deferProvider)
    return { pendingRefund: { account, payment, refund, booking: b, user } };
  return finishRefund(db, provider, {
    account,
    payment,
    refund,
    booking: b,
    user,
  });
}
export async function finishRefund(
  db,
  provider,
  { account, payment, refund, booking: b, user },
) {
  const r = await provider.refund(account, payment, refund.id);
  await db.query(
    "update refunds set provider_refund_id=$1,status=$2 where id=$3",
    [r.id, r.status, refund.id],
  );
  await db.query(
    "update booking_transactions set refund_status=$1 where id=$2",
    [r.status, payment.id],
  );
  if (r.status === "succeeded")
    await db.query("update bookings set status='refunded' where id=$1", [b.id]);
  await audit(db, user, b.club_id, "refund.requested", refund.id, {
    booking_id: b.id,
    amount: refund.amount,
  });
  return { id: refund.id, status: r.status };
}
export async function payoutChange(db, user, input, provider) {
  await membership(db, user, input.club_id, "payoutChange");
  const account = await one(
    db,
    "select * from payment_accounts where club_id=$1 and active for update",
    [input.club_id],
  );
  if (!account?.provider_account_id)
    throw new HttpError(409, "Start payment onboarding first.");
  const proof = await one(
    db,
    "update step_up_tokens set used_at=now() where token_hash=$1 and user_id=$2 and club_id=$3 and used_at is null and expires_at>now() returning *",
    [hash(input.step_up_token || ""), user.id, input.club_id],
  );
  if (!proof)
    throw new HttpError(
      403,
      "Re-enter your password before changing payment details.",
      "STEP_UP_REQUIRED",
    );
  let change = await one(
    db,
    "select * from payout_changes where club_id=$1 and status!='completed' for update",
    [input.club_id],
  );
  if (!change) {
    const previous = await one(
      db,
      "select provider_reference from payout_destinations where payment_account_id=$1 and active",
      [account.id],
    );
    const hours = Number(process.env.PAYOUT_CHANGE_HOLD_HOURS || 48);
    if (!Number.isInteger(hours) || hours < 24)
      throw new HttpError(
        503,
        "The payout security hold must be at least 24 hours.",
      );
    change = await one(
      db,
      "insert into payout_changes(id,club_id,payment_account_id,actor_user_id,previous_reference,hold_until) values($1,$2,$3,$4,$5,$6) returning *",
      [
        uuid(),
        input.club_id,
        account.id,
        user.id,
        previous?.provider_reference || null,
        new Date(Date.now() + hours * 3600000),
      ],
    );
  }
  await provider.pause(account.provider_account_id, `payout-hold-${change.id}`);
  await db.query(
    "update payment_accounts set payouts_enabled=false,onboarding_status='PAYOUTS_PAUSED' where id=$1",
    [account.id],
  );
  const link = await provider.onboarding(
    account.provider_account_id,
    input.club_id,
    true,
  );
  await financeNotification(
    db,
    input.club_id,
    "Jimmi payout security notification",
    `The Club Owner requested a payment details update. Automatic payouts are paused for security review and at least ${process.env.PAYOUT_CHANGE_HOLD_HOURS || 48} hours. If this was unexpected, contact the Club Owner immediately.`,
  );
  await audit(db, user, input.club_id, "payout.change_requested", change.id);
  return { url: link.url, hold_until: change.hold_until };
}
