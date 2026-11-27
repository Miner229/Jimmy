// Unit tests for the payments server code. Stripe and Supabase are replaced by in-memory
// fakes; database rules themselves are verified against the Supabase test project
// (see docs/PAYMENTS.md, "Verification").
import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, loadConfig, STRIPE_API_VERSION } from '../server/payments/config.js';
import { createStripeClient, encodeForm, StripeApiError } from '../server/payments/stripe-client.js';
import { computeSignature, verifyStripeSignature, SignatureError } from '../server/payments/webhook-signature.js';
import { createPaymentsService, derivePaymentState, feeMinor, PaymentError } from '../server/payments/service.js';
import { handlePaymentsRequest } from '../server/payments/router.js';
import { handleConnectWebhook } from '../server/payments/webhook-handler.js';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const REFUND = '44444444-4444-4444-8444-444444444444';
const HOST = '55555555-5555-4555-8555-555555555555';
const ACCT = 'acct_1TestHost000001';
const USER = { id: '66666666-6666-4666-8666-666666666666', email: 'player@example.com' };

const CONFIG = {
  stripeSecretKey: 'sk_test_x', livemode: false, webhookSecret: 'whsec_test', feeBps: 100,
  appOrigin: 'http://localhost:3000', supabaseUrl: 'https://x.supabase.co', supabaseSecretKey: 'sb_secret_x',
  supabasePublishableKey: 'sb_publishable_x', cronSecret: 'cron-secret',
};

function fakeDb(handlers = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const h = handlers[name];
      return typeof h === 'function' ? h(args) : h ?? { ok: true };
    },
  };
}

function fakeStripe(handlers = {}) {
  const calls = [];
  const call = async (method, path, opts = {}) => {
    calls.push({ method, path, ...opts });
    const key = `${method} ${path}`;
    const h = handlers[key] ?? Object.entries(handlers).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    if (h === undefined) throw new Error(`Unexpected Stripe call ${key}`);
    return typeof h === 'function' ? h(opts) : h;
  };
  return { calls, get: (p, o) => call('GET', p, o), post: (p, o) => call('POST', p, o) };
}

const quietLog = () => {};

// ---------------------------------------------------------------------------
// Fees and configuration
// ---------------------------------------------------------------------------

test('1% application fee uses half-up rounding to the penny', () => {
  assert.equal(feeMinor(1000, 100), 10); // £10.00 -> 10p
  assert.equal(feeMinor(750, 100), 8);   // 7.5p rounds up
  assert.equal(feeMinor(749, 100), 7);
  assert.equal(feeMinor(30, 100), 0);    // Stripe minimum charge: no fee
  assert.equal(feeMinor(1234567, 100), 12346);
});

test('config blocks live Stripe keys unless explicitly allowed', () => {
  const env = {
    STRIPE_SECRET_KEY: 'sk_live_abc', APP_ORIGIN: 'https://x.test', SUPABASE_URL: 'https://s',
    SUPABASE_SECRET_KEY: 'sb_secret_x', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  };
  assert.throws(() => loadConfig(env), ConfigError);
  const test = loadConfig({ ...env, STRIPE_SECRET_KEY: 'sk_test_abc' });
  assert.equal(test.livemode, false);
  assert.equal(test.feeBps, 100);
  assert.throws(() => loadConfig({ ...env, STRIPE_SECRET_KEY: 'sk_test_abc', PLATFORM_FEE_BPS: 'x' }), ConfigError);
  assert.throws(() => loadConfig({ ...env, STRIPE_SECRET_KEY: undefined }), ConfigError);
});

// ---------------------------------------------------------------------------
// Stripe HTTP client
// ---------------------------------------------------------------------------

test('form encoding follows Stripe bracket syntax', () => {
  assert.equal(
    encodeForm({ line_items: [{ quantity: 1, price_data: { unit_amount: 1000 } }], a: true, skip: undefined }),
    'line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1000&a=true',
  );
});

test('Stripe client sends version, account and idempotency headers and retries with the same key', async () => {
  const seen = [];
  let attempt = 0;
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    attempt += 1;
    if (attempt === 1) return new Response('{"error":{"type":"api_error"}}', { status: 500 });
    return new Response('{"id":"cs_test_1"}', { status: 200 });
  };
  const client = createStripeClient({ secretKey: 'sk_test_x', fetchImpl });
  const out = await client.post('/v1/checkout/sessions', { stripeAccount: ACCT, idempotencyKey: 'k1', params: { mode: 'payment' } });
  assert.equal(out.id, 'cs_test_1');
  assert.equal(seen.length, 2);
  for (const { init } of seen) {
    assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    assert.equal(init.headers['Stripe-Account'], ACCT);
    assert.equal(init.headers['Idempotency-Key'], 'k1');
  }
});

test('Stripe client does not retry a 400 and exposes the error code', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such"}}', { status: 400 });
  };
  const client = createStripeClient({ secretKey: 'sk_test_x', fetchImpl });
  await assert.rejects(client.get('/v1/refunds/re_1', { stripeAccount: ACCT }), (e) => e instanceof StripeApiError && e.code === 'resource_missing');
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

test('webhook signature: valid, tampered, expired and multiple v1 values', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'account.updated' });
  const now = 1_800_000_000;
  const sig = computeSignature(payload, 'whsec_test', now);
  assert.equal(verifyStripeSignature(payload, `t=${now},v1=${sig}`, 'whsec_test', { nowSeconds: now }).id, 'evt_1');
  assert.equal(verifyStripeSignature(payload, `t=${now},v1=deadbeef,v1=${sig}`, 'whsec_test', { nowSeconds: now }).id, 'evt_1');
  assert.throws(() => verifyStripeSignature(payload + ' ', `t=${now},v1=${sig}`, 'whsec_test', { nowSeconds: now }), SignatureError);
  assert.throws(() => verifyStripeSignature(payload, `t=${now},v1=${sig}`, 'whsec_test', { nowSeconds: now + 301 }), SignatureError);
  assert.throws(() => verifyStripeSignature(payload, `t=${now},v1=${sig}`, 'whsec_other', { nowSeconds: now }), SignatureError);
  assert.throws(() => verifyStripeSignature(payload, 'garbage', 'whsec_test', { nowSeconds: now }), SignatureError);
  assert.throws(() => verifyStripeSignature(payload, `t=${now},v1=${sig}`, '', { nowSeconds: now }), SignatureError);
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const RESERVED = {
  ok: true, reuse: false, booking_id: BOOKING, payment_id: PAYMENT, amount_minor: 1000, application_fee_minor: 10,
  currency: 'gbp', stripe_account_id: ACCT, livemode: false, title: 'Friday doubles',
  checkout_expires_at: '2026-12-01T10:31:00+00:00',
};

test('checkout creates the session on the host account with the fee, expiry and idempotency key', async () => {
  const db = fakeDb({ payments_reserve_seat: RESERVED });
  const stripe = fakeStripe({ 'POST /v1/checkout/sessions': { id: 'cs_test_A', url: 'https://checkout.stripe.com/c/pay/cs_test_A' } });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.startCheckout(USER, { session_id: SESSION });

  assert.equal(out.url, 'https://checkout.stripe.com/c/pay/cs_test_A');
  const reserve = db.calls.find((c) => c.name === 'payments_reserve_seat');
  assert.deepEqual(reserve.args, { p_session_id: SESSION, p_user_id: USER.id, p_fee_bps: 100, p_hold_minutes: 31 });

  const [call] = stripe.calls;
  const expires = Math.floor(Date.parse(RESERVED.checkout_expires_at) / 1000);
  assert.equal(call.stripeAccount, ACCT);
  assert.equal(call.idempotencyKey, `checkout-${PAYMENT}-${expires}`);
  assert.equal(call.params.mode, 'payment');
  assert.equal(call.params.payment_intent_data.application_fee_amount, 10);
  assert.equal(call.params.line_items[0].price_data.unit_amount, 1000);
  assert.equal(call.params.line_items[0].price_data.currency, 'gbp');
  assert.equal(call.params.expires_at, expires);
  assert.equal(call.params.metadata.jimmiplay_booking_id, BOOKING);
  assert.equal(call.params.client_reference_id, BOOKING);
  assert.ok(call.params.success_url.endsWith('&session_id={CHECKOUT_SESSION_ID}'));
  assert.equal(call.params.payment_method_types, undefined, 'payment methods come from the host Dashboard settings');

  const attach = db.calls.find((c) => c.name === 'payments_attach_checkout');
  assert.deepEqual(attach.args, { p_payment_id: PAYMENT, p_checkout_session_id: 'cs_test_A', p_url: 'https://checkout.stripe.com/c/pay/cs_test_A' });
});

test('checkout reuses an open Checkout Session instead of creating another', async () => {
  const db = fakeDb({ payments_reserve_seat: { ok: true, reuse: true, booking_id: BOOKING, checkout_url: 'https://checkout.stripe.com/x' } });
  const stripe = fakeStripe({});
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.startCheckout(USER, { session_id: SESSION });
  assert.equal(out.url, 'https://checkout.stripe.com/x');
  assert.equal(stripe.calls.length, 0);
});

test('checkout refusals become 409 errors with a readable message', async () => {
  const db = fakeDb({ payments_reserve_seat: { ok: false, code: 'session_full' } });
  const service = createPaymentsService({ config: CONFIG, stripe: fakeStripe({}), db, log: quietLog });
  await assert.rejects(service.startCheckout(USER, { session_id: SESSION }),
    (e) => e instanceof PaymentError && e.status === 409 && e.code === 'session_full' && /full/.test(e.message));
  await assert.rejects(service.startCheckout(USER, { session_id: 'not-a-uuid' }), (e) => e.status === 400);
});

test('a Stripe failure during checkout is recorded and reported without leaking details', async () => {
  const db = fakeDb({ payments_reserve_seat: RESERVED });
  const stripe = fakeStripe({ 'POST /v1/checkout/sessions': () => { throw new StripeApiError({ status: 400, code: 'parameter_invalid' }); } });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await assert.rejects(service.startCheckout(USER, { session_id: SESSION }), (e) => e.code === 'checkout_failed' && e.status === 502);
  assert.ok(db.calls.some((c) => c.name === 'payments_record_checkout_error' && c.args.p_payment_id === PAYMENT));
});

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

const COMPLETED_SESSION = {
  id: 'cs_test_A', status: 'complete', payment_status: 'paid', livemode: false, amount_total: 1000, currency: 'gbp',
  payment_intent: 'pi_A', client_reference_id: BOOKING, metadata: { jimmiplay_booking_id: BOOKING },
};

test('checkout.session.completed re-reads the session in the event account and fulfils it once', async () => {
  const db = fakeDb({ payments_begin_event: 'new', payments_fulfil: { ok: true, code: 'confirmed', booking_id: BOOKING } });
  const stripe = fakeStripe({ 'GET /v1/checkout/sessions/cs_test_A': COMPLETED_SESSION });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.handleEvent({ id: 'evt_1', type: 'checkout.session.completed', account: ACCT, livemode: false, data: { object: { id: 'cs_test_A' } } });

  assert.equal(out.outcome, 'confirmed');
  assert.equal(stripe.calls[0].stripeAccount, ACCT);
  const fulfil = db.calls.find((c) => c.name === 'payments_fulfil').args;
  assert.deepEqual(fulfil, {
    p_account: ACCT, p_livemode: false, p_checkout_session_id: 'cs_test_A', p_booking_id: BOOKING,
    p_payment_status: 'paid', p_payment_intent_id: 'pi_A', p_amount_total: 1000, p_currency: 'gbp',
  });
  assert.deepEqual(db.calls.at(-1), { name: 'payments_finish_event', args: { p_event_id: 'evt_1', p_error: null } });
});

test('an already processed event is not processed again', async () => {
  const db = fakeDb({ payments_begin_event: 'done' });
  const stripe = fakeStripe({});
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.handleEvent({ id: 'evt_1', type: 'checkout.session.completed', account: ACCT, livemode: false, data: { object: { id: 'cs_test_A' } } });
  assert.equal(out.status, 'duplicate');
  assert.equal(stripe.calls.length, 0);
});

test('platform events and events from the other mode are ignored', async () => {
  const db = fakeDb({});
  const service = createPaymentsService({ config: CONFIG, stripe: fakeStripe({}), db, log: quietLog });
  assert.equal((await service.handleEvent({ id: 'evt_p', type: 'account.updated', data: { object: {} } })).status, 'ignored_platform_event');
  assert.equal((await service.handleEvent({ id: 'evt_l', type: 'account.updated', account: ACCT, livemode: true, data: { object: {} } })).status, 'ignored_other_mode');
  assert.equal(db.calls.length, 0);
});

test('a failing handler records the error and rethrows so Stripe retries', async () => {
  const db = fakeDb({ payments_begin_event: 'new' });
  const stripe = fakeStripe({ 'GET /v1/checkout/sessions/cs_test_A': () => { throw new StripeApiError({ status: 500, code: 'api_error' }); } });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await assert.rejects(service.handleEvent({ id: 'evt_2', type: 'checkout.session.completed', account: ACCT, livemode: false, data: { object: { id: 'cs_test_A' } } }));
  const finish = db.calls.find((c) => c.name === 'payments_finish_event');
  assert.equal(finish.args.p_event_id, 'evt_2');
  assert.match(finish.args.p_error, /api_error/);
});

test('a late payment for a seat that is no longer free is refunded in full with the fee', async () => {
  const db = fakeDb({
    payments_begin_event: 'new',
    payments_fulfil: { ok: true, code: 'refund_required', booking_id: BOOKING },
    payments_request_refund: { ok: true, existing: false, refund_id: REFUND, stripe_refund_id: null, amount_minor: 1000, payment_intent_id: 'pi_A', stripe_account_id: ACCT },
    payments_record_refund: { ok: true, booking_status: 'late_paid' },
  });
  const stripe = fakeStripe({
    'GET /v1/checkout/sessions/cs_test_A': COMPLETED_SESSION,
    'GET /v1/refunds': { data: [] },
    'POST /v1/refunds': { id: 're_1', amount: 1000, status: 'pending', payment_intent: 'pi_A', metadata: { jimmiplay_refund_id: REFUND } },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await service.handleEvent({ id: 'evt_3', type: 'checkout.session.completed', account: ACCT, livemode: false, data: { object: { id: 'cs_test_A' } } });

  assert.deepEqual(db.calls.find((c) => c.name === 'payments_request_refund').args, { p_booking_id: BOOKING, p_actor: null, p_mode: 'late_payment' });
  const post = stripe.calls.find((c) => c.method === 'POST' && c.path === '/v1/refunds');
  assert.equal(post.stripeAccount, ACCT);
  assert.equal(post.idempotencyKey, `refund-${REFUND}`);
  assert.equal(post.params.refund_application_fee, true);
  assert.equal(post.params.amount, 1000);
  const recorded = db.calls.find((c) => c.name === 'payments_record_refund').args;
  assert.equal(recorded.p_stripe_refund_id, 're_1');
  assert.equal(recorded.p_refund_id, REFUND);
  assert.equal(recorded.p_status, 'pending');
});

test('a refund created by an earlier attempt is found and recorded instead of re-issued', async () => {
  const db = fakeDb({
    payments_request_refund: { ok: true, existing: true, refund_id: REFUND, stripe_refund_id: null, amount_minor: 1000, payment_intent_id: 'pi_A', stripe_account_id: ACCT },
    payments_record_refund: { ok: true, booking_status: 'cancelled_refunded' },
  });
  const stripe = fakeStripe({
    'GET /v1/refunds': { data: [{ id: 're_old', amount: 1000, status: 'succeeded', payment_intent: 'pi_A', metadata: { jimmiplay_refund_id: REFUND } }] },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.cancelBooking(USER, { booking_id: BOOKING });
  assert.equal(out.booking_status, 'cancelled_refunded');
  assert.equal(stripe.calls.filter((c) => c.method === 'POST').length, 0);
});

test('a refund that fails to submit stays pending for the reconcile job', async () => {
  const db = fakeDb({
    payments_request_refund: { ok: true, existing: false, refund_id: REFUND, stripe_refund_id: null, amount_minor: 1000, payment_intent_id: 'pi_A', stripe_account_id: ACCT },
  });
  const stripe = fakeStripe({
    'GET /v1/refunds': { data: [] },
    'POST /v1/refunds': () => { throw new StripeApiError({ status: 0, type: 'network_error' }); },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  const out = await service.cancelBooking(USER, { booking_id: BOOKING });
  assert.equal(out.retry_scheduled, true);
  assert.equal(out.booking_status, 'refund_pending');
});

test('charge.refunded records every refund on the charge, including Dashboard refunds', async () => {
  const db = fakeDb({ payments_begin_event: 'new', payments_record_refund: { ok: true } });
  const stripe = fakeStripe({
    'GET /v1/refunds': (opts) => {
      assert.deepEqual(opts.params, { charge: 'ch_1', limit: 100 });
      return { data: [{ id: 're_dash', amount: 300, status: 'succeeded', payment_intent: 'pi_A', metadata: {} }] };
    },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await service.handleEvent({ id: 'evt_4', type: 'charge.refunded', account: ACCT, livemode: false, data: { object: { id: 'ch_1' } } });
  const rec = db.calls.find((c) => c.name === 'payments_record_refund').args;
  assert.equal(rec.p_refund_id, null);
  assert.equal(rec.p_stripe_refund_id, 're_dash');
});

test('dispute events store status, amount and the evidence deadline', async () => {
  const db = fakeDb({ payments_begin_event: 'new', payments_record_dispute: { ok: true } });
  const stripe = fakeStripe({
    'GET /v1/disputes/dp_1': { id: 'dp_1', status: 'needs_response', reason: 'fraudulent', amount: 1000, payment_intent: 'pi_A', charge: 'ch_1', evidence_details: { due_by: 1_800_000_000 } },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await service.handleEvent({ id: 'evt_5', type: 'charge.dispute.created', account: ACCT, livemode: false, data: { object: { id: 'dp_1' } } });
  const args = db.calls.find((c) => c.name === 'payments_record_dispute').args;
  assert.equal(args.p_status, 'needs_response');
  assert.equal(args.p_evidence_due_by, new Date(1_800_000_000 * 1000).toISOString());
});

test('account.updated stores charges, payouts, requirements and capabilities from Stripe', async () => {
  const db = fakeDb({ payments_begin_event: 'new', payments_sync_host: { ok: true } });
  const stripe = fakeStripe({
    [`GET /v1/accounts/${ACCT}`]: {
      id: ACCT, charges_enabled: false, payouts_enabled: false, details_submitted: true,
      requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due' },
      capabilities: { card_payments: 'inactive' },
    },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await service.handleEvent({ id: 'evt_6', type: 'account.updated', account: ACCT, livemode: false, data: { object: { id: ACCT } } });
  const args = db.calls.find((c) => c.name === 'payments_sync_host').args;
  assert.equal(args.p_charges_enabled, false);
  assert.equal(args.p_disabled_reason, 'requirements.past_due');
  assert.deepEqual(args.p_requirements.currently_due, ['external_account']);
  assert.deepEqual(args.p_capabilities, { card_payments: 'inactive' });
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

test('onboarding creates a full-Dashboard v1 account once and returns an Account Link', async () => {
  const db = fakeDb({ payments_create_host: { ok: true, host_id: HOST }, payments_attach_account: { ok: true } });
  const stripe = fakeStripe({
    'POST /v1/accounts': { id: ACCT },
    'POST /v1/account_links': { url: 'https://connect.stripe.com/setup/s/abc', expires_at: 1 },
  });
  const service = createPaymentsService({ config: CONFIG, stripe, db, log: quietLog });
  await assert.rejects(service.onboardHost(USER, { display_name: 'X', host_type: 'club' }), (e) => e.status === 400);
  const out = await service.onboardHost(USER, { display_name: 'Crystal Palace BC', host_type: 'club', payment_entity_type: 'organisation' });

  assert.equal(out.url, 'https://connect.stripe.com/setup/s/abc');
  assert.equal(db.calls.find((c) => c.name === 'payments_create_host').args.p_payment_entity_type, 'organisation');
  const create = stripe.calls[0];
  assert.deepEqual(create.params.controller, { stripe_dashboard: { type: 'full' } });
  assert.equal(create.params.capabilities, undefined, 'full-Dashboard accounts manage their own capabilities');
  assert.equal(create.idempotencyKey, `account-create-${HOST}`);
  const link = stripe.calls[1].params;
  assert.equal(link.type, 'account_onboarding');
  assert.equal(link.account, ACCT);
  assert.equal(link.refresh_url, `http://localhost:3000/dev53/payments?tab=host&onboarding=refresh&host=${HOST}`);
  assert.equal(link.return_url, `http://localhost:3000/dev53/payments?tab=host&onboarding=return&host=${HOST}`);
});

test('club payment state follows the Stripe account state (spec §16)', () => {
  const base = { stripe_account_id: ACCT, details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: {} };
  assert.equal(derivePaymentState({}), 'NOT_STARTED');
  assert.equal(derivePaymentState({ ...base, details_submitted: false, charges_enabled: false }), 'ONBOARDING');
  assert.equal(derivePaymentState({ ...base, charges_enabled: false, requirements: { pending_verification: ['individual.verification.document'] } }), 'REQUIREMENTS_PENDING');
  assert.equal(derivePaymentState({ ...base, charges_enabled: false, requirements: { past_due: ['external_account'] } }), 'ADDITIONAL_VERIFICATION_REQUIRED');
  assert.equal(derivePaymentState({ ...base, charges_enabled: false, disabled_reason: 'rejected.fraud' }), 'RESTRICTED');
  assert.equal(derivePaymentState({ ...base, payouts_enabled: false }), 'PAYOUTS_PAUSED');
  assert.equal(derivePaymentState(base), 'PAYOUTS_ENABLED');
  assert.equal(derivePaymentState({ ...base, deauthorized_at: '2026-11-27T00:00:00Z' }), 'DISABLED');
});

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function deps(overrides = {}) {
  return {
    config: CONFIG,
    getUser: async (token) => (token === 'good' ? USER : null),
    service: {
      listSessions: async () => [{ id: SESSION }],
      reconcile: async () => ({ reservations: 0, refunds: 0, events: 0, errors: 0 }),
      myBookings: async () => [],
      handleEvent: async () => ({ status: 'processed' }),
      ...overrides,
    },
  };
}

test('API: public session list, sign-in required elsewhere, cron secret required for jobs', async () => {
  let res = await handlePaymentsRequest(new Request('http://x/api/payments?route=sessions'), deps());
  assert.equal(res.status, 200);
  res = await handlePaymentsRequest(new Request('http://x/api/payments?route=bookings'), deps());
  assert.equal(res.status, 401);
  res = await handlePaymentsRequest(new Request('http://x/api/payments?route=bookings', { headers: { Authorization: 'Bearer good' } }), deps());
  assert.equal(res.status, 200);
  res = await handlePaymentsRequest(new Request('http://x/api/payments?route=jobs/reconcile', { headers: { Authorization: 'Bearer wrong' } }), deps());
  assert.equal(res.status, 401);
  res = await handlePaymentsRequest(new Request('http://x/api/payments?route=jobs/reconcile', { headers: { Authorization: 'Bearer cron-secret' } }), deps());
  assert.equal(res.status, 200);
  res = await handlePaymentsRequest(new Request('http://x/api/payments?route=nope', { headers: { Authorization: 'Bearer good' } }), deps());
  assert.equal(res.status, 404);
});

test('webhook endpoint rejects bad signatures and accepts valid ones', async () => {
  const payload = JSON.stringify({ id: 'evt_9', type: 'account.updated', account: ACCT, livemode: false, data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  let res = await handleConnectWebhook(new Request('http://x/api/stripe/connect-webhook', {
    method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=00` },
  }), deps());
  assert.equal(res.status, 400);
  res = await handleConnectWebhook(new Request('http://x/api/stripe/connect-webhook', {
    method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${computeSignature(payload, 'whsec_test', t)}` },
  }), deps());
  assert.equal(res.status, 200);
});
