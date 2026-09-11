import { one, uuid, audit, hash } from "./db.js";
import { HttpError } from "./domain.js";
import { syncAccount, financeNotification } from "./clubs.js";
export async function syncBanks(db, provider, account) {
  const banks = await provider.banks(account.provider_account_id);
  const bank = banks.find(
    (b) => b.default_for_currency && b.currency === "gbp",
  );
  const old = await one(
    db,
    "select * from payout_destinations where payment_account_id=$1 and active",
    [account.id],
  );
  let change = await one(
    db,
    "select * from payout_changes where payment_account_id=$1 and status!='completed' for update",
    [account.id],
  );
  if (old && bank?.id !== old.provider_reference && !change) {
    await provider.pause(
      account.provider_account_id,
      `unexpected-bank-${account.id}-${bank?.id || "removed"}`,
    );
    change = await one(
      db,
      "insert into payout_changes(id,club_id,payment_account_id,actor_user_id,previous_reference,new_reference,hold_until,status) select $1,$2,$3,user_id,$4,$5,now()+interval '48 hours','holding' from club_memberships where club_id=$2 and role='Owner' and status='active' returning *",
      [
        uuid(),
        account.club_id,
        account.id,
        old.provider_reference,
        bank?.id || null,
      ],
    );
    await db.query(
      "insert into risk_flags(id,club_id,signal) values($1,$2,'unexpected_payout_destination_change')",
      [uuid(), account.club_id],
    );
    await financeNotification(
      db,
      account.club_id,
      "Unexpected payout destination change",
      "The payment provider reported a changed payout destination. Payouts are paused pending review.",
    );
    await audit(
      db,
      null,
      account.club_id,
      "payout.unexpected_change",
      account.id,
    );
  }
  await db.query(
    "update payout_destinations set active=false where payment_account_id=$1",
    [account.id],
  );
  if (bank?.fingerprint) {
    const fingerprint = hash(bank.fingerprint);
    await db.query(
      "update payout_destinations set fingerprint_hash=$1 where provider_reference=$2",
      [fingerprint, bank.id],
    );
    const shared = await one(
      db,
      "select p.id from payout_destinations p join payment_accounts a on a.id=p.payment_account_id where p.fingerprint_hash=$1 and a.club_id!=$2 limit 1",
      [fingerprint, account.club_id],
    );
    if (
      shared &&
      !(await one(
        db,
        "select id from risk_flags where club_id=$1 and signal='shared_payout_destination' and status='review'",
        [account.club_id],
      ))
    )
      await db.query(
        "insert into risk_flags(id,club_id,signal) values($1,$2,'shared_payout_destination')",
        [uuid(), account.club_id],
      );
  }
  if (bank) {
    await db.query(
      `insert into payout_destinations(id,payment_account_id,provider_reference,bank_display_name,last4,status,active) values($1,$2,$3,$4,$5,$6,$7) on conflict(provider_reference) do update set bank_display_name=excluded.bank_display_name,last4=excluded.last4,status=excluded.status,active=excluded.active,updated_at=now()`,
      [
        uuid(),
        account.id,
        bank.id,
        bank.bank_name || "Bank",
        bank.last4,
        bank.status,
        ["validated", "verified"].includes(bank.status) && !change,
      ],
    );
    if (bank.fingerprint)
      await db.query(
        "update payout_destinations set fingerprint_hash=$1 where provider_reference=$2",
        [hash(bank.fingerprint), bank.id],
      );
    if (change && bank.id !== change.new_reference) {
      const hours = Math.max(
        24,
        Number(process.env.PAYOUT_CHANGE_HOLD_HOURS || 48),
      );
      await db.query(
        "update payout_changes set new_reference=$1,status='holding',hold_until=$2 where id=$3",
        [bank.id, new Date(Date.now() + hours * 3600000), change.id],
      );
    }
  }
  if (change)
    await db.query(
      "update payment_accounts set payouts_enabled=false,onboarding_status='PAYOUTS_PAUSED' where id=$1",
      [account.id],
    );
}
export async function processEvent(db, provider, event) {
  const inserted = await one(
    db,
    "insert into provider_events(provider_event_id,event_type,account_id) values($1,$2,$3) on conflict do nothing returning provider_event_id",
    [event.id, event.type, event.account || null],
  );
  if (!inserted) return { duplicate: true };
  const object = event.data.object;
  const accountId =
    event.account || (event.type === "account.updated" ? object.id : null);
  const account = await one(
    db,
    "select * from payment_accounts where provider_account_id=$1 for update",
    [accountId],
  );
  if (!account) return { ignored: true };
  if (
    event.type === "account.updated" ||
    event.type.startsWith("account.external_account.")
  ) {
    await syncBanks(db, provider, account);
    await syncAccount(db, provider, account);
  }
  if (event.type.startsWith("payment_intent.")) {
    const p = await provider.payment(object.id, accountId);
    const bId = p.metadata?.booking_id;
    const tx = await one(
      db,
      "select * from booking_transactions where booking_id=$1 and payment_account_id=$2 for update",
      [bId, account.id],
    );
    if (!tx)
      throw new HttpError(
        409,
        "Payment record is not available yet. Retry webhook.",
      );
    if (
      p.metadata.club_id !== tx.club_id ||
      p.metadata.session_id !== tx.session_id ||
      p.amount !== tx.gross_amount ||
      p.currency !== "gbp"
    )
      throw new HttpError(409, "Payment metadata or amount mismatch.");
    const charge = p.latest_charge;
    const fee =
      typeof charge === "object" &&
      typeof charge.balance_transaction === "object"
        ? (charge.balance_transaction?.fee_details
            ?.filter((f) => f.type === "stripe_fee")
            .reduce((sum, f) => sum + f.amount, 0) ?? null)
        : null;
    await db.query(
      "update booking_transactions set provider_payment_id=$1,payment_status=$2,provider_fee=$3 where id=$4",
      [p.id, p.status, fee, tx.id],
    );
    if (p.status === "succeeded") {
      await db.query(
        "update bookings set status=case when status in ('refunded','cancelled') then status else 'confirmed' end where id=$1",
        [bId],
      );
      await audit(db, null, tx.club_id, "payment.succeeded", tx.id);
    }
  }
  if (event.type === "checkout.session.expired") {
    await db.query(
      "update bookings set status='failed' where (checkout_id=$1 or id::text=$3) and club_id=$2 and status='pending'",
      [object.id, account.club_id, object.metadata?.booking_id || ""],
    );
  }
  if (event.type.startsWith("refund.")) {
    const r = await provider.refundStatus(object.id, accountId);
    const tx = await one(
      db,
      "select * from booking_transactions where provider_payment_id=$1 and payment_account_id=$2 for update",
      [r.payment_intent, account.id],
    );
    if (!tx) throw new HttpError(409, "Refund payment linkage not available.");
    await db.query("update refunds set status=$1 where provider_refund_id=$2", [
      r.status,
      r.id,
    ]);
    await db.query(
      "update booking_transactions set refund_status=$1 where id=$2",
      [r.status, tx.id],
    );
    if (r.status === "succeeded" && r.amount === tx.gross_amount)
      await db.query("update bookings set status='refunded' where id=$1", [
        tx.booking_id,
      ]);
    await audit(db, null, tx.club_id, "refund.status_changed", r.id, {
      status: r.status,
    });
  }
  if (event.type.startsWith("charge.dispute.")) {
    const d = await provider.dispute(object.id, accountId);
    const tx = await one(
      db,
      "select * from booking_transactions where provider_payment_id=$1 and payment_account_id=$2",
      [d.payment_intent, account.id],
    );
    if (!tx) throw new HttpError(409, "Dispute payment linkage not available.");
    await db.query(
      "insert into disputes(provider_dispute_id,transaction_id,club_id,status,amount) values($1,$2,$3,$4,$5) on conflict(provider_dispute_id) do update set status=excluded.status,updated_at=now()",
      [d.id, tx.id, tx.club_id, d.status, d.amount],
    );
    await db.query(
      "update booking_transactions set dispute_status=$1 where id=$2",
      [d.status, tx.id],
    );
    await audit(db, null, tx.club_id, "dispute.status_changed", d.id, {
      status: d.status,
    });
    await financeNotification(
      db,
      tx.club_id,
      "Jimmi payment dispute update",
      `A Club payment dispute is now ${d.status}. Check the Club finance dashboard.`,
    );
  }
  if (event.type.startsWith("payout.")) {
    const p = await provider.payout(object.id, accountId);
    await db.query(
      "insert into payouts(provider_payout_id,club_id,payment_account_id,amount,currency,status,failure_code) values($1,$2,$3,$4,$5,$6,$7) on conflict(provider_payout_id) do update set status=excluded.status,failure_code=excluded.failure_code,updated_at=now()",
      [
        p.id,
        account.club_id,
        account.id,
        p.amount,
        p.currency,
        p.status,
        p.failure_code,
      ],
    );
    if (p.status === "failed") {
      await db.query(
        "update payment_accounts set payouts_enabled=false,onboarding_status='PAYOUTS_PAUSED' where id=$1",
        [account.id],
      );
      await financeNotification(
        db,
        account.club_id,
        "Jimmi payout failed",
        "A payout failed. Check the Club finance dashboard and payment requirements.",
      );
    }
  }
  return { received: true };
}
