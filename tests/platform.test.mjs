import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  authorize,
  assertPublish,
  paymentState,
  validateInvitation,
  requireVerified,
} from "../server/domain.js";
import {
  createClub,
  acceptInvite,
  invite,
  saveSession,
  mutateMember,
  startOnboarding,
} from "../server/clubs.js";
import { checkout, payoutChange, refundBooking } from "../server/payments.js";
import { processEvent } from "../server/webhooks.js";
import { one, hash } from "../server/db.js";
let engine, db;
const id = () => randomUUID();
const owner = {
  id: id(),
  email: "owner@example.com",
  full_name: "Owner",
  email_verified_at: new Date(),
  status: "active",
};
const admin = {
  id: id(),
  email: "admin@example.com",
  full_name: "Admin",
  email_verified_at: new Date(),
  status: "active",
};
const organizer = {
  id: id(),
  email: "organizer@example.com",
  full_name: "Organizer",
  email_verified_at: new Date(),
  status: "active",
};
const player = {
  id: id(),
  email: "player@example.com",
  full_name: "Player",
  email_verified_at: new Date(),
  status: "active",
};
let club, clubB, session, account, booking, transactionId;
const provider = {
  async account() {
    return {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      business_type: "individual",
      requirements: {},
    };
  },
  async checkout(a, s, b) {
    return { id: "cs_" + b.id, url: "https://checkout.stripe.com/test" };
  },
  async refund(a, p, i) {
    return { id: "re_" + i, status: "succeeded" };
  },
  async pause() {},
  async onboarding() {
    return { url: "https://connect.stripe.com/test" };
  },
  async banks() {
    return [];
  },
};
before(async () => {
  process.env.APP_ORIGIN = "https://example.com";
  engine = new PGlite();
  db = { query: (sql, args) => engine.query(sql, args) };
  await engine.exec(
    await readFile("db/migrations/001_payment_onboarding.sql", "utf8"),
  );
  for (const u of [owner, admin, organizer, player])
    await db.query(
      "insert into users(id,email,full_name,email_verified_at) values($1,$2,$3,$4)",
      [u.id, u.email, u.full_name, u.email_verified_at],
    );
});
after(async () => {
  await engine.close();
});
test("Unverified users cannot create clubs, activate memberships or invoke permissions", async () => {
  assert.throws(
    () => requireVerified({ ...owner, email_verified_at: null }),
    /verify your email/,
  );
  await assert.rejects(
    () =>
      createClub(
        db,
        { ...owner, email_verified_at: null },
        { name: "A", primary_sport: "Badminton", main_area: "London" },
      ),
    /verify your email/,
  );
});
test("Verified user creates Club and automatically becomes Owner, without KYC", async () => {
  club = (
    await createClub(db, owner, {
      name: "Club A",
      primary_sport: "Badminton",
      main_area: "London",
    })
  ).id;
  clubB = (
    await createClub(db, owner, {
      name: "Club B",
      primary_sport: "Tennis",
      main_area: "Bromley",
    })
  ).id;
  const m = await one(db, "select * from club_memberships where club_id=$1", [
    club,
  ]);
  assert.equal(m.role, "Owner");
  assert.equal(
    (await db.query("select * from payment_accounts")).rows.length,
    0,
  );
});
test("Email invitations bind role/email, are hashed, single use and allow multi-Club roles", async () => {
  for (const [u, role, c] of [
    [admin, "Admin", club],
    [organizer, "Organizer", club],
    [organizer, "Admin", clubB],
  ]) {
    const result = await invite(db, owner, {
      club_id: c,
      email: u.email,
      role,
    });
    const outbox = await one(
      db,
      "select * from email_outbox where recipient=$1 order by created_at desc limit 1",
      [u.email],
    );
    const secret = outbox.body.match(/invitation=([a-f0-9]+)/)[1];
    const row = await one(db, "select * from club_invitations where id=$1", [
      result.id,
    ]);
    assert.notEqual(row.token_hash, secret);
    await assert.rejects(
      () => acceptInvite(db, player, secret),
      /email address/,
    );
    await acceptInvite(db, u, secret);
    await assert.rejects(() => acceptInvite(db, u, secret), /no longer valid/);
  }
  const roles = (
    await db.query("select role from club_memberships where user_id=$1", [
      organizer.id,
    ])
  ).rows
    .map((x) => x.role)
    .sort();
  assert.deepEqual(roles, ["Admin", "Organizer"]);
});
test("Expired, revoked, accepted and wrong-email invitations are rejected", () => {
  const base = { email: owner.email, expires_at: new Date(Date.now() + 10000) };
  for (const variation of [
    { expires_at: new Date(0) },
    { revoked_at: new Date() },
    { accepted_at: new Date() },
  ])
    assert.throws(
      () => validateInvitation({ ...base, ...variation }, owner),
      /expired|valid/,
    );
  assert.throws(() => validateInvitation(base, admin), /email address/);
});
test("Admin cannot invite Admin or change membership roles", async () => {
  await assert.rejects(
    () =>
      invite(db, admin, {
        club_id: club,
        email: "x@example.com",
        role: "Admin",
      }),
    /only invite Organizers/,
  );
  const m = await one(
    db,
    "select * from club_memberships where user_id=$1 and club_id=$2",
    [organizer.id, club],
  );
  await assert.rejects(
    () =>
      mutateMember(db, admin, {
        club_id: club,
        id: m.id,
        action: "role",
        role: "Admin",
      }),
    /permission/,
  );
});
const sessionInput = () => ({
  club_id: club,
  title: "Free badminton",
  venue: "Sports hall",
  starts_at: new Date(Date.now() + 86400000 * 3).toISOString(),
  ends_at: new Date(Date.now() + 86400000 * 3 + 3600000).toISOString(),
  capacity: 8,
  price: 0,
  publish: true,
});
test("Organizer publishes a free Session without KYC, financially owned by Club", async () => {
  session = (await saveSession(db, organizer, sessionInput(), null)).id;
  const s = await one(db, "select * from sessions where id=$1", [session]);
  assert.equal(s.club_id, club);
  assert.equal(s.organizer_user_id, organizer.id);
  assert.equal(s.status, "published");
});
test("Paid drafts allowed; paid publishing requires capability, not merely onboarding UI completion", async () => {
  const d = await saveSession(
    db,
    organizer,
    { ...sessionInput(), price: 1000, publish: false },
    null,
  );
  assert.equal(d.status, "draft");
  await assert.rejects(
    () => saveSession(db, organizer, { ...sessionInput(), price: 1000 }, null),
    /Set up Club payments/,
  );
  assert.throws(
    () =>
      assertPublish(
        { price: 1000 },
        {
          active: true,
          provider_account_id: "acct_a",
          onboarding_status: "VERIFIED",
          payments_enabled: false,
        },
      ),
    /Set up Club payments/,
  );
});
test("Cross-Club and unassigned Session permissions are server rejected", async () => {
  const m = await one(
    db,
    "select * from club_memberships where user_id=$1 and club_id=$2",
    [organizer.id, club],
  );
  assert.throws(
    () =>
      authorize(organizer, m, "editSession", {
        club_id: club,
        organizer_user_id: owner.id,
      }),
    /assigned/,
  );
  assert.throws(
    () =>
      authorize(organizer, m, "viewBookings", {
        club_id: clubB,
        organizer_user_id: organizer.id,
      }),
    /different Club/,
  );
  assert.throws(() => authorize(organizer, m, "viewFinance"), /permission/);
});
test("Individual and company onboarding use one account per Club, separate from memberships", async () => {
  const fake = {
    async createAccount(c) {
      return { id: "acct_" + c.id };
    },
    async account() {
      return { details_submitted: false };
    },
    async onboarding() {
      return { url: "https://connect.stripe.com/test" };
    },
  };
  await startOnboarding(
    db,
    owner,
    { club_id: club, entity: "individual" },
    fake,
  );
  await startOnboarding(db, owner, { club_id: clubB, entity: "company" }, fake);
  account = await one(db, "select * from payment_accounts where club_id=$1", [
    club,
  ]);
  const b = await one(db, "select * from payment_accounts where club_id=$1", [
    clubB,
  ]);
  assert.notEqual(account.provider_account_id, b.provider_account_id);
  await startOnboarding(
    db,
    owner,
    { club_id: club, entity: "individual" },
    fake,
  );
  assert.equal(
    (await db.query("select * from payment_accounts where club_id=$1", [club]))
      .rows.length,
    1,
  );
});
test("Database rejects second active payment account and payout destination", async () => {
  await assert.rejects(
    () =>
      db.query("insert into payment_accounts(id,club_id) values($1,$2)", [
        id(),
        club,
      ]),
    /unique|duplicate/i,
  );
  await db.query(
    "insert into payout_destinations(id,payment_account_id,provider_reference,last4,status,active) values($1,$2,$3,$4,$5,true)",
    [id(), account.id, "ba_a", "1234", "verified"],
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into payout_destinations(id,payment_account_id,provider_reference,last4,status,active) values($1,$2,$3,$4,$5,true)",
        [id(), account.id, "ba_b", "6789", "verified"],
      ),
    /unique|duplicate/i,
  );
});
test("Owner/Admin/Organizer payout permissions and required step-up are enforced", async () => {
  for (const u of [admin, organizer])
    await assert.rejects(
      () => payoutChange(db, u, { club_id: club }, provider),
      /permission/,
    );
  await assert.rejects(
    () => payoutChange(db, owner, { club_id: club }, provider),
    /password/,
  );
  await db.query(
    "insert into step_up_tokens(token_hash,user_id,club_id,expires_at) values($1,$2,$3,now()+interval '5 minutes')",
    [hash("proof"), owner.id, club],
  );
  await payoutChange(
    db,
    owner,
    { club_id: club, step_up_token: "proof" },
    provider,
  );
  assert.ok(
    await one(
      db,
      "select * from audit_events where event_type='payout.change_requested' and club_id=$1",
      [club],
    ),
  );
  assert.ok(
    await one(
      db,
      "select * from email_outbox where subject='Jimmi payout security notification'",
    ),
  );
  await assert.rejects(
    () =>
      payoutChange(
        db,
        owner,
        { club_id: club, step_up_token: "proof" },
        provider,
      ),
    /password/,
  );
});
test("Paid checkout references the Club account and original Session, not the Organizer", async () => {
  const paid = await saveSession(
    db,
    organizer,
    { ...sessionInput(), price: 1000 },
    provider,
  );
  const r = await checkout(db, player, { session_id: paid.id }, provider);
  booking = r.id;
  const tx = await one(
    db,
    "select * from booking_transactions where booking_id=$1",
    [booking],
  );
  transactionId = tx.id;
  assert.equal(tx.club_id, club);
  assert.equal(tx.payment_account_id, account.id);
  assert.equal(tx.gross_amount, 1000);
  assert.equal(tx.platform_fee, 50);
});
test("Duplicate payment webhooks mutate financial state once; stale events use current provider state", async () => {
  const tx = await one(db, "select * from booking_transactions where id=$1", [
    transactionId,
  ]);
  provider.payment = async () => ({
    id: "pi_a",
    amount: 1000,
    currency: "gbp",
    status: "succeeded",
    metadata: { booking_id: booking, club_id: club, session_id: tx.session_id },
  });
  const event = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    account: account.provider_account_id,
    data: { object: { id: "pi_a" } },
  };
  await processEvent(db, provider, event);
  assert.deepEqual(await processEvent(db, provider, event), {
    duplicate: true,
  });
  assert.equal(
    (await one(db, "select * from bookings where id=$1", [booking])).status,
    "confirmed",
  );
  assert.equal(
    (
      await db.query(
        "select * from audit_events where event_type='payment.succeeded'",
      )
    ).rows.length,
    1,
  );
});
test("Authorized refund links original payment, booking, amount, actor and audit", async () => {
  await assert.rejects(
    () =>
      refundBooking(
        db,
        organizer,
        { booking_id: booking, reason: "Cancelled" },
        provider,
      ),
    /permission/,
  );
  const refund = await refundBooking(
    db,
    admin,
    { booking_id: booking, reason: "Session cancelled" },
    provider,
  );
  const row = await one(db, "select * from refunds where id=$1", [refund.id]);
  assert.equal(row.transaction_id, transactionId);
  assert.equal(row.actor_user_id, admin.id);
  assert.equal(row.amount, 1000);
  assert.equal(
    (await one(db, "select * from bookings where id=$1", [booking])).status,
    "refunded",
  );
  const repeated = await refundBooking(
    db,
    admin,
    { booking_id: booking, reason: "Retry" },
    provider,
  );
  assert.equal(repeated.id, refund.id);
});
test("Removing Organizer preserves all Session, booking and Club revenue references", async () => {
  const m = await one(
    db,
    "select * from club_memberships where club_id=$1 and user_id=$2",
    [club, organizer.id],
  );
  await mutateMember(db, owner, { club_id: club, id: m.id, action: "remove" });
  assert.ok(await one(db, "select * from sessions where id=$1", [session]));
  assert.equal(
    (
      await one(db, "select * from booking_transactions where id=$1", [
        transactionId,
      ])
    ).club_id,
    club,
  );
  assert.ok(await one(db, "select * from bookings where id=$1", [booking]));
  await assert.rejects(
    () => saveSession(db, organizer, sessionInput(), null),
    /permission/,
  );
});
test("Provider restrictions and hold precedence cannot be inferred from UI", () => {
  assert.equal(
    paymentState({ requirements: { disabled_reason: "rejected.fraud" } }),
    "DISABLED",
  );
  assert.equal(
    paymentState(
      { charges_enabled: true, payouts_enabled: true, requirements: {} },
      true,
    ),
    "PAYOUTS_PAUSED",
  );
  assert.equal(
    paymentState({
      charges_enabled: false,
      requirements: { currently_due: ["individual.id_number"] },
    }),
    "REQUIREMENTS_PENDING",
  );
});

test("Database prevents transaction routing to another Club account", async () => {
  const tx = await one(db, "select * from booking_transactions where id=$1", [
    transactionId,
  ]);
  const other = await one(
    db,
    "select * from payment_accounts where club_id=$1",
    [clubB],
  );
  await assert.rejects(
    () =>
      db.query(
        "update booking_transactions set payment_account_id=$1 where id=$2",
        [other.id, tx.id],
      ),
    /foreign key/i,
  );
});
test("A failed webhook transaction can be retried instead of being marked processed", async () => {
  const event = {
    id: "evt_bad_metadata",
    type: "payment_intent.succeeded",
    account: account.provider_account_id,
    data: { object: { id: "pi_bad" } },
  };
  const old = provider.payment;
  provider.payment = async () => ({
    id: "pi_bad",
    amount: 999,
    currency: "gbp",
    status: "succeeded",
    metadata: { booking_id: booking, club_id: club, session_id: session },
  });
  await engine.exec("begin");
  try {
    await processEvent(db, provider, event);
    assert.fail("expected mismatch");
  } catch (e) {
    await engine.exec("rollback");
    assert.match(e.message, /mismatch/);
  }
  assert.equal(
    await one(db, "select * from provider_events where provider_event_id=$1", [
      event.id,
    ]),
    undefined,
  );
  provider.payment = old;
});
test("Stripe webhook requires a valid signature over the raw body", async () => {
  const { PaymentProviderService } =
    await import("../server/payment-provider.js");
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe("sk_test_placeholder");
  const p = new PaymentProviderService(stripe);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const payload = JSON.stringify({
    id: "evt_signature",
    type: "account.updated",
    data: { object: { id: "acct_1" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_test",
  });
  assert.equal(p.verify(payload, signature).id, "evt_signature");
  assert.throws(() => p.verify(payload + " ", signature));
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test("Payout hold only releases a verified bank after its deadline and not during risk review", async () => {
  const { syncBanks } = await import("../server/webhooks.js");
  const { releaseHolds } = await import("../server/jobs.js");
  let resumed = 0;
  provider.resume = async () => {
    resumed++;
  };
  provider.banks = async () => [
    {
      id: "ba_new",
      default_for_currency: true,
      currency: "gbp",
      bank_name: "Test Bank",
      last4: "3812",
      status: "validated",
    },
  ];
  await syncBanks(db, provider, account);
  assert.equal(
    (
      await db.query(
        "select * from payout_destinations where payment_account_id=$1 and active",
        [account.id],
      )
    ).rows.length,
    0,
  );
  await releaseHolds(db, provider);
  assert.equal(resumed, 0);
  await db.query(
    "update payout_changes set hold_until=now()-interval '1 minute' where payment_account_id=$1",
    [account.id],
  );
  await db.query(
    "insert into risk_flags(id,club_id,signal) values($1,$2,'review_test')",
    [id(), club],
  );
  await releaseHolds(db, provider);
  assert.equal(resumed, 0);
  await db.query("update risk_flags set status='cleared' where club_id=$1", [
    club,
  ]);
  await releaseHolds(db, provider);
  assert.equal(resumed, 1);
  const bank = await one(
    db,
    "select * from payout_destinations where payment_account_id=$1 and active",
    [account.id],
  );
  assert.equal(bank.last4, "3812");
  assert.ok(
    await one(
      db,
      "select * from audit_events where event_type='payout.change_completed'",
    ),
  );
});
test("Persisted checkout intent and idempotency identity survive provider failure for retry", async () => {
  const paid = await saveSession(
    db,
    owner,
    { ...sessionInput(), price: 1200 },
    provider,
  );
  const prepared = await checkout(
    db,
    player,
    { session_id: paid.id },
    provider,
    true,
  );
  const before = prepared.pendingCheckout.booking.id;
  const { finishCheckout } = await import("../server/payments.js");
  await assert.rejects(
    () =>
      finishCheckout(
        db,
        {
          checkout: async () => {
            throw Error("network failure");
          },
        },
        prepared.pendingCheckout,
      ),
    /network failure/,
  );
  const retry = await checkout(
    db,
    player,
    { session_id: paid.id },
    provider,
    true,
  );
  assert.equal(retry.pendingCheckout.booking.id, before);
  assert.equal(
    (
      await db.query("select * from booking_transactions where booking_id=$1", [
        before,
      ])
    ).rows.length,
    1,
  );
  await finishCheckout(db, provider, retry.pendingCheckout);
});
