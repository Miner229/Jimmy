// JimmiPlay payments: Stripe Connect Direct Charges with Accounts v1 (full Stripe Dashboard hosts).
// Business rules that touch seats or money live in the payments_* database functions
// (db/migrations/0002_payment_functions.sql); this module talks to Stripe and calls them.

import { MIN_PRICE_MINOR, RESERVATION_HOLD_MINUTES, appUrl } from './config.js';
import { StripeApiError } from './stripe-client.js';

export class PaymentError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'PaymentError';
    this.status = status;
    this.code = code;
  }
}

const MESSAGES = {
  session_not_found: 'This session was not found.',
  session_not_bookable: 'This session is not open for booking.',
  session_started: 'This session has already started.',
  session_full: 'This session is full.',
  free_sessions_not_supported: 'Free sessions are not handled by payments yet.',
  host_cannot_accept_payments: 'The host cannot take payments yet.',
  already_booked: 'You already have a place in this session.',
  payment_processing: 'Your payment is still processing. We will confirm your place when it completes.',
  reservation_expiring: 'Your previous checkout is closing. Please try again in a few minutes.',
  not_booking_owner: 'This booking belongs to someone else.',
  booking_not_refundable: 'This booking cannot be refunded.',
  refund_deadline_passed: 'The refund deadline for this session has passed.',
  no_successful_payment: 'There is no successful payment to refund.',
  payment_disputed: 'This payment is disputed, so it cannot be refunded here.',
  already_refunded: 'This booking has already been refunded.',
  not_host_owner: 'You do not manage this host.',
  host_not_found: 'Host not found.',
  starts_in_past: 'The start time must be in the future.',
  profile_not_found: 'Your profile is not ready yet. Please sign in again.',
  livemode_mismatch: 'Test and live data cannot be mixed.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_ID_RE = /^[a-z]{2,6}_[A-Za-z0-9_]{6,255}$/;

// Mirror of public.payments_fee_minor: integer half-up rounding to the nearest penny.
export function feeMinor(amountMinor, feeBps) {
  return Math.floor((amountMinor * feeBps + 5000) / 10000);
}

// Club payment state from JIMMI_PAYMENT_ONBOARDING_SPEC.md §16, derived only from the
// Stripe account state mirrored in the hosts table (Stripe is authoritative).
export function derivePaymentState(host) {
  if (!host?.stripe_account_id) return 'NOT_STARTED';
  if (host.deauthorized_at) return 'DISABLED';
  const req = host.requirements || {};
  const due = [...(req.past_due || []), ...(req.currently_due || [])];
  if (!host.details_submitted) return 'ONBOARDING';
  if (!host.charges_enabled) {
    if (due.length > 0) return 'ADDITIONAL_VERIFICATION_REQUIRED';
    if ((req.pending_verification || []).length > 0) return 'REQUIREMENTS_PENDING';
    return host.disabled_reason ? 'RESTRICTED' : 'VERIFIED';
  }
  if (due.length > 0) return 'ADDITIONAL_VERIFICATION_REQUIRED';
  return host.payouts_enabled ? 'PAYOUTS_ENABLED' : 'PAYOUTS_PAUSED';
}

function refuse(result, status = 409) {
  const code = result?.code || 'request_refused';
  throw new PaymentError(status, code, MESSAGES[code] || 'The request could not be completed.');
}

function invalid(field) {
  throw new PaymentError(400, 'invalid_input', `Please check ${field}.`);
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) invalid(field);
  return value;
}

function requireStripeId(value, prefix, field) {
  if (typeof value !== 'string' || !STRIPE_ID_RE.test(value) || !value.startsWith(`${prefix}_`)) invalid(field);
  return value;
}

function idOf(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

// Logs carry IDs and codes only: no emails, names, card details or secrets.
function defaultLog(level, message, fields = {}) {
  const line = JSON.stringify({ scope: 'payments', level, message, ...fields });
  if (level === 'error') console.error(line); else console.log(line);
}

export function createPaymentsService({ config, stripe, db, log = defaultLog }) {
  // -------------------------------------------------------------------------
  // Hosts and onboarding
  // -------------------------------------------------------------------------

  async function hostsOf(user) {
    const hosts = (await db.rpc('payments_host_overview', { p_user_id: user.id })) || [];
    return hosts.map((h) => ({ ...h, payment_state: derivePaymentState(h) }));
  }

  async function hostForUser(user, hostId) {
    requireUuid(hostId, 'host');
    const host = (await hostsOf(user)).find((h) => h.id === hostId);
    if (!host) throw new PaymentError(404, 'host_not_found', MESSAGES.host_not_found);
    return host;
  }

  async function syncHostFromAccount(account) {
    const req = account.requirements || {};
    return db.rpc('payments_sync_host', {
      p_account: account.id,
      p_livemode: config.livemode,
      p_charges_enabled: Boolean(account.charges_enabled),
      p_payouts_enabled: Boolean(account.payouts_enabled),
      p_details_submitted: Boolean(account.details_submitted),
      p_requirements: {
        currently_due: req.currently_due || [],
        past_due: req.past_due || [],
        eventually_due: req.eventually_due || [],
        pending_verification: req.pending_verification || [],
        current_deadline: req.current_deadline || null,
        errors: (req.errors || []).map((e) => ({ code: e.code, requirement: e.requirement })),
      },
      p_disabled_reason: req.disabled_reason || null,
      p_capabilities: account.capabilities || {},
    });
  }

  // Creates the host (if needed) and its Stripe account (if needed), then returns a fresh
  // single-use Account Link. Called again by the refresh_url page when a link has expired.
  async function onboardHost(user, body = {}) {
    let host;
    if (body.host_id) {
      host = await hostForUser(user, body.host_id);
    } else {
      const displayName = String(body.display_name || '').trim();
      if (displayName.length < 1 || displayName.length > 120) invalid('the host name');
      if (!['club', 'individual'].includes(body.host_type)) invalid('the host type');
      // Spec §11 "How is this Club operated?": Jimmi metadata only; Stripe decides what to verify.
      if (!['individual', 'company', 'organisation'].includes(body.payment_entity_type)) invalid('how the host is operated');
      const created = await db.rpc('payments_create_host', {
        p_user_id: user.id, p_display_name: displayName, p_host_type: body.host_type,
        p_payment_entity_type: body.payment_entity_type,
      });
      if (!created?.ok) refuse(created);
      host = {
        id: created.host_id, host_type: body.host_type, payment_entity_type: body.payment_entity_type,
        stripe_account_id: null,
      };
    }

    let accountId = host.stripe_account_id;
    if (!accountId) {
      // https://docs.stripe.com/connect/hosted-onboarding?accounts-namespace=v1
      // Full Dashboard: Stripe collects requirements; fees.payer=account, losses.payments=stripe
      // and requirement_collection=stripe are the defaults and are left unset.
      const account = await stripe.post('/v1/accounts', {
        idempotencyKey: `account-create-${host.id}`,
        params: {
          controller: { stripe_dashboard: { type: 'full' } },
          country: 'GB',
          email: user.email || undefined,
          business_profile: { product_description: 'Badminton sessions booked through JimmiPlay' },
          metadata: {
            jimmiplay_host_id: host.id,
            jimmiplay_host_type: host.host_type,
            jimmiplay_payment_entity_type: host.payment_entity_type || '',
          },
        },
      });
      const attached = await db.rpc('payments_attach_account', {
        p_host_id: host.id, p_account: account.id, p_livemode: config.livemode,
      });
      if (!attached?.ok) refuse(attached);
      accountId = account.id;
      log('info', 'host.account_created', { host_id: host.id, account: accountId });
    }

    const link = await stripe.post('/v1/account_links', {
      params: {
        account: accountId,
        type: 'account_onboarding',
        collection_options: { fields: 'eventually_due' },
        refresh_url: appUrl(config, { tab: 'host', onboarding: 'refresh', host: host.id }),
        return_url: appUrl(config, { tab: 'host', onboarding: 'return', host: host.id }),
      },
    });
    return { host_id: host.id, url: link.url, expires_at: link.expires_at };
  }

  // On return from onboarding (and whenever the host opens the page): read the real account
  // state from Stripe, store it, and show requirements, capabilities and balances.
  async function hostStatus(user, hostId) {
    const host = await hostForUser(user, hostId);
    if (!host.stripe_account_id) return { host, account: null };

    const account = await stripe.get(`/v1/accounts/${encodeURIComponent(host.stripe_account_id)}`);
    await syncHostFromAccount(account);

    let balance = null;
    try {
      const b = await stripe.get('/v1/balance', { stripeAccount: host.stripe_account_id });
      const sum = (list) => (list || []).filter((x) => x.currency === 'gbp').reduce((t, x) => t + x.amount, 0);
      balance = { currency: 'gbp', available_minor: sum(b.available), pending_minor: sum(b.pending) };
    } catch (error) {
      log('error', 'host.balance_unavailable', { host_id: host.id, code: error.code || error.name });
    }

    const refreshed = await hostForUser(user, hostId);
    const req = account.requirements || {};
    return {
      host: refreshed,
      payment_state: refreshed.payment_state,
      account: {
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted),
        currently_due: req.currently_due || [],
        past_due: req.past_due || [],
        pending_verification: req.pending_verification || [],
        disabled_reason: req.disabled_reason || null,
        current_deadline: req.current_deadline || null,
        capabilities: account.capabilities || {},
        payout_schedule: account.settings?.payouts?.schedule || null,
      },
      balance,
    };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async function createSession(user, body = {}) {
    const hostId = requireUuid(body.host_id, 'host');
    const title = String(body.title || '').trim();
    const venue = String(body.venue || '').trim();
    if (title.length < 1 || title.length > 200) invalid('the title');
    if (venue.length < 1 || venue.length > 300) invalid('the venue');
    const startsAt = new Date(body.starts_at);
    const endsAt = new Date(body.ends_at);
    if (Number.isNaN(startsAt.getTime())) invalid('the start time');
    if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) invalid('the end time');
    if (endsAt - startsAt > 24 * 3600 * 1000) invalid('the end time');
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) invalid('the capacity');
    const priceMinor = Number(body.price_minor);
    if (!Number.isInteger(priceMinor) || priceMinor < MIN_PRICE_MINOR || priceMinor > 1000000) invalid('the price');
    const deadline = Number(body.refund_deadline_hours ?? 24);
    if (!Number.isInteger(deadline) || deadline < 0 || deadline > 720) invalid('the refund deadline');

    const result = await db.rpc('payments_create_session', {
      p_user_id: user.id, p_host_id: hostId, p_title: title, p_venue: venue,
      p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(), p_capacity: capacity,
      p_price_minor: priceMinor, p_refund_deadline_hours: deadline, p_publish: body.publish !== false,
    });
    if (!result?.ok) refuse(result);
    return { session_id: result.session_id };
  }

  const listSessions = async () => (await db.rpc('payments_list_sessions', {})) || [];
  const hostOverview = async (user) => hostsOf(user);
  const myBookings = async (user) => (await db.rpc('payments_my_bookings', { p_user_id: user.id })) || [];

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  // https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted
  async function startCheckout(user, body = {}) {
    const sessionId = requireUuid(body.session_id, 'the session');
    const r = await db.rpc('payments_reserve_seat', {
      p_session_id: sessionId, p_user_id: user.id, p_fee_bps: config.feeBps,
      p_hold_minutes: RESERVATION_HOLD_MINUTES,
    });
    if (!r?.ok) refuse(r);
    if (r.reuse) return { booking_id: r.booking_id, url: r.checkout_url };
    if (r.livemode !== config.livemode) refuse({ code: 'livemode_mismatch' });

    const expiresAt = Math.floor(new Date(r.checkout_expires_at).getTime() / 1000);
    let session;
    try {
      session = await stripe.post('/v1/checkout/sessions', {
        stripeAccount: r.stripe_account_id,
        idempotencyKey: `checkout-${r.payment_id}-${expiresAt}`,
        params: {
          mode: 'payment',
          line_items: [{
            quantity: 1,
            price_data: { currency: r.currency, unit_amount: r.amount_minor, product_data: { name: r.title } },
          }],
          payment_intent_data: {
            application_fee_amount: r.application_fee_minor,
            metadata: { jimmiplay_booking_id: r.booking_id, jimmiplay_payment_id: r.payment_id },
          },
          client_reference_id: r.booking_id,
          metadata: { jimmiplay_booking_id: r.booking_id, jimmiplay_payment_id: r.payment_id },
          customer_email: user.email || undefined,
          expires_at: expiresAt,
          success_url: appUrl(config, { tab: 'bookings', checkout: 'success' }) + '&session_id={CHECKOUT_SESSION_ID}',
          cancel_url: appUrl(config, { tab: 'book', checkout: 'cancelled' }),
        },
      });
    } catch (error) {
      await db.rpc('payments_record_checkout_error', {
        p_payment_id: r.payment_id, p_error: `${error.code || error.name}: ${error.message}`,
      });
      log('error', 'checkout.create_failed', { payment_id: r.payment_id, code: error.code || error.name });
      throw new PaymentError(502, 'checkout_failed', 'Payment could not be started. Please try again.');
    }
    const attached = await db.rpc('payments_attach_checkout', {
      p_payment_id: r.payment_id, p_checkout_session_id: session.id, p_url: session.url,
    });
    if (!attached?.ok) refuse(attached);
    return { booking_id: r.booking_id, url: session.url };
  }

  // One idempotent fulfilment path for the webhook, the return page and the reconcile job.
  async function fulfilCheckoutSession(session, account) {
    const bookingId = session.metadata?.jimmiplay_booking_id || session.client_reference_id || null;
    const paymentIntentId = idOf(session.payment_intent);
    const result = await db.rpc('payments_fulfil', {
      p_account: account,
      p_livemode: Boolean(session.livemode),
      p_checkout_session_id: session.id,
      p_booking_id: bookingId && UUID_RE.test(bookingId) ? bookingId : null,
      p_payment_status: session.payment_status,
      p_payment_intent_id: paymentIntentId,
      p_amount_total: session.amount_total,
      p_currency: session.currency,
    });
    log('info', 'checkout.fulfil', { checkout_session: session.id, account, code: result?.code });

    if (result?.code === 'refund_required') {
      // Late payment for a seat that is no longer available: refund in full.
      try {
        await refundBooking(result.booking_id, null, 'late_payment');
      } catch (error) {
        log('error', 'refund.late_payment_failed', { booking_id: result.booking_id, code: error.code || error.name });
      }
    }
    if (result?.code === 'duplicate_payment' && paymentIntentId) {
      const refund = await stripe.post('/v1/refunds', {
        stripeAccount: account,
        idempotencyKey: `duplicate-${session.id}`,
        params: {
          payment_intent: paymentIntentId,
          refund_application_fee: true,
          metadata: { jimmiplay_reason: 'duplicate_checkout', jimmiplay_booking_id: bookingId || '' },
        },
      });
      await db.rpc('payments_audit', {
        p_actor: null, p_action: 'refund.duplicate_checkout', p_entity: 'payment', p_entity_id: result.payment_id,
        p_metadata: { checkout_session: session.id, stripe_refund_id: refund.id, status: refund.status },
      });
    }
    return result;
  }

  async function checkoutReturn(user, checkoutSessionId) {
    requireStripeId(checkoutSessionId, 'cs', 'the checkout session');
    const ctx = await db.rpc('payments_checkout_context', {
      p_user_id: user.id, p_checkout_session_id: checkoutSessionId,
    });
    if (!ctx?.ok) throw new PaymentError(404, 'not_found', 'Booking not found.');
    const session = await stripe.get(`/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`, {
      stripeAccount: ctx.stripe_account_id,
    });
    let code = session.status;
    if (session.status === 'complete') {
      code = (await fulfilCheckoutSession(session, ctx.stripe_account_id))?.code;
    } else if (session.status === 'expired') {
      code = (await db.rpc('payments_release', {
        p_account: ctx.stripe_account_id, p_checkout_session_id: session.id, p_payment_id: null,
        p_reason: 'checkout_expired',
      }))?.code;
    }
    const booking = (await myBookings(user)).find((b) => b.id === ctx.booking_id) || null;
    return { result: code, booking };
  }

  // -------------------------------------------------------------------------
  // Refunds (https://docs.stripe.com/refunds)
  // -------------------------------------------------------------------------

  async function recordRefund(refund, account, localRefundId) {
    return db.rpc('payments_record_refund', {
      p_account: account,
      p_livemode: config.livemode,
      p_payment_intent_id: idOf(refund.payment_intent),
      p_refund_id: localRefundId || (UUID_RE.test(refund.metadata?.jimmiplay_refund_id || '') ? refund.metadata.jimmiplay_refund_id : null),
      p_stripe_refund_id: refund.id,
      p_amount: refund.amount,
      p_status: refund.status,
      p_failure_reason: refund.failure_reason || null,
    });
  }

  // Submits (or re-checks) one refund row. Before re-issuing, it looks for a refund that an
  // earlier attempt may already have created, using metadata.jimmiplay_refund_id.
  async function executeRefund(row) {
    const account = row.stripe_account_id;
    if (row.stripe_refund_id) {
      const refund = await stripe.get(`/v1/refunds/${encodeURIComponent(row.stripe_refund_id)}`, { stripeAccount: account });
      return recordRefund(refund, account, row.refund_id);
    }
    const existing = await stripe.get('/v1/refunds', {
      stripeAccount: account, params: { payment_intent: row.payment_intent_id, limit: 100 },
    });
    const match = (existing.data || []).find((r) => r.metadata?.jimmiplay_refund_id === row.refund_id);
    if (match) return recordRefund(match, account, row.refund_id);

    // Full refund of the remaining amount; refund_application_fee returns JimmiPlay's fee
    // in proportion to the amount refunded.
    const refund = await stripe.post('/v1/refunds', {
      stripeAccount: account,
      idempotencyKey: `refund-${row.refund_id}`,
      params: {
        payment_intent: row.payment_intent_id,
        amount: row.amount_minor,
        refund_application_fee: true,
        metadata: { jimmiplay_refund_id: row.refund_id },
      },
    });
    return recordRefund(refund, account, row.refund_id);
  }

  async function refundBooking(bookingId, actorId, mode) {
    requireUuid(bookingId, 'the booking');
    const r = await db.rpc('payments_request_refund', { p_booking_id: bookingId, p_actor: actorId, p_mode: mode });
    if (!r?.ok) refuse(r);
    try {
      const recorded = await executeRefund(r);
      return { refund_id: r.refund_id, booking_status: recorded?.booking_status };
    } catch (error) {
      // The refund row stays 'requested'; the reconcile job retries after checking Stripe.
      log('error', 'refund.submit_failed', { refund_id: r.refund_id, code: error.code || error.name });
      return { refund_id: r.refund_id, booking_status: 'refund_pending', retry_scheduled: true };
    }
  }

  const cancelBooking = (user, body = {}) => refundBooking(body.booking_id, user.id, 'player_cancel');

  async function cancelSession(user, body = {}) {
    const sessionId = requireUuid(body.session_id, 'the session');
    const r = await db.rpc('payments_cancel_session', { p_session_id: sessionId, p_actor: user.id });
    if (!r?.ok) refuse(r);

    let released = 0;
    for (const open of r.open_checkouts || []) {
      if (open.checkout_session_id) {
        try {
          await stripe.post(`/v1/checkout/sessions/${encodeURIComponent(open.checkout_session_id)}/expire`, {
            stripeAccount: open.stripe_account_id, idempotencyKey: `expire-${open.checkout_session_id}`,
          });
        } catch (error) {
          if (!(error instanceof StripeApiError)) throw error;
        }
        const session = await stripe.get(`/v1/checkout/sessions/${encodeURIComponent(open.checkout_session_id)}`, {
          stripeAccount: open.stripe_account_id,
        });
        if (session.status === 'complete') {
          await fulfilCheckoutSession(session, open.stripe_account_id); // goes to the late-payment refund path
          continue;
        }
      }
      await db.rpc('payments_release', {
        p_account: open.stripe_account_id, p_checkout_session_id: open.checkout_session_id || null,
        p_payment_id: open.payment_id, p_reason: 'session_cancelled',
      });
      released += 1;
    }

    const refunds = [];
    for (const bookingId of r.paid_booking_ids || []) {
      try {
        refunds.push({ booking_id: bookingId, ...(await refundBooking(bookingId, user.id, 'host_cancel')) });
      } catch (error) {
        refunds.push({ booking_id: bookingId, error: error.code || 'refund_failed' });
      }
    }
    return { released_reservations: released, refunds };
  }

  // -------------------------------------------------------------------------
  // Webhook events (Connect endpoint: events on connected accounts)
  // https://docs.stripe.com/connect/webhooks?accounts-namespace=v1
  // Every handler re-reads the object from Stripe in the event's account context, so
  // duplicate and out-of-order deliveries converge on Stripe's current state.
  // -------------------------------------------------------------------------

  async function processEvent(event) {
    const account = event.account;
    const object = event.data?.object || {};
    const type = event.type;

    if (type === 'account.updated' || type === 'capability.updated') {
      const acct = await stripe.get(`/v1/accounts/${encodeURIComponent(account)}`);
      return (await syncHostFromAccount(acct))?.code || 'synced';
    }
    if (type === 'account.application.deauthorized') {
      return (await db.rpc('payments_host_deauthorized', { p_account: account }))?.code || 'deauthorized';
    }
    if (type.startsWith('checkout.session.')) {
      const session = await stripe.get(`/v1/checkout/sessions/${encodeURIComponent(object.id)}`, { stripeAccount: account });
      if (type === 'checkout.session.async_payment_failed') {
        return (await db.rpc('payments_release', {
          p_account: account, p_checkout_session_id: session.id, p_payment_id: null, p_reason: 'async_payment_failed',
        }))?.code;
      }
      if (session.status === 'complete') return (await fulfilCheckoutSession(session, account))?.code;
      if (session.status === 'expired') {
        return (await db.rpc('payments_release', {
          p_account: account, p_checkout_session_id: session.id, p_payment_id: null, p_reason: 'checkout_expired',
        }))?.code;
      }
      return 'session_open';
    }
    if (type === 'charge.refunded' || type === 'charge.refund.updated') {
      const chargeId = type === 'charge.refunded' ? object.id : idOf(object.charge);
      const list = await stripe.get('/v1/refunds', { stripeAccount: account, params: { charge: chargeId, limit: 100 } });
      for (const refund of list.data || []) await recordRefund(refund, account, null);
      return `refunds_recorded:${(list.data || []).length}`;
    }
    if (type.startsWith('refund.')) {
      const refund = await stripe.get(`/v1/refunds/${encodeURIComponent(object.id)}`, { stripeAccount: account });
      return (await recordRefund(refund, account, null))?.code || 'refund_recorded';
    }
    if (type.startsWith('charge.dispute.')) {
      const dispute = await stripe.get(`/v1/disputes/${encodeURIComponent(object.id)}`, { stripeAccount: account });
      const due = dispute.evidence_details?.due_by;
      return (await db.rpc('payments_record_dispute', {
        p_account: account, p_livemode: Boolean(event.livemode), p_dispute_id: dispute.id,
        p_payment_intent_id: idOf(dispute.payment_intent), p_charge_id: idOf(dispute.charge),
        p_status: dispute.status, p_reason: dispute.reason || null, p_amount: dispute.amount,
        p_evidence_due_by: due ? new Date(due * 1000).toISOString() : null,
      }))?.code || 'dispute_recorded';
    }
    if (type.startsWith('payout.')) {
      // Payout timing belongs to full-Dashboard hosts; JimmiPlay records outcomes for support.
      await db.rpc('payments_audit', {
        p_actor: null, p_action: type, p_entity: 'payout', p_entity_id: object.id,
        p_metadata: { account, status: object.status, amount: object.amount, currency: object.currency,
          failure_code: object.failure_code || null, arrival_date: object.arrival_date || null },
      });
      return 'payout_recorded';
    }
    return 'ignored';
  }

  async function handleEvent(event) {
    if (!event?.id || !event.type) throw new PaymentError(400, 'invalid_event', 'Invalid event');
    if (!event.account) return { status: 'ignored_platform_event' };
    if (Boolean(event.livemode) !== config.livemode) return { status: 'ignored_other_mode' };

    const state = await db.rpc('payments_begin_event', {
      p_event_id: event.id, p_type: event.type, p_account: event.account, p_livemode: Boolean(event.livemode),
    });
    if (state === 'done') return { status: 'duplicate' };
    try {
      const outcome = await processEvent(event);
      await db.rpc('payments_finish_event', { p_event_id: event.id, p_error: null });
      log('info', 'webhook.processed', { event_id: event.id, type: event.type, account: event.account, outcome });
      return { status: 'processed', outcome };
    } catch (error) {
      await db.rpc('payments_finish_event', { p_event_id: event.id, p_error: `${error.code || error.name}: ${error.message}` })
        .catch(() => {});
      log('error', 'webhook.failed', { event_id: event.id, type: event.type, code: error.code || error.name });
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Reconcile job: stale reservations, unfinished refunds, failed events
  // -------------------------------------------------------------------------

  async function reconcile() {
    const summary = { reservations: 0, refunds: 0, events: 0, errors: 0 };
    await db.rpc('payments_audit', { p_actor: null, p_action: 'job.reconcile.started', p_entity: 'job', p_entity_id: 'reconcile', p_metadata: {} });

    for (const row of (await db.rpc('payments_stale_reservations', { p_limit: 50 })) || []) {
      try {
        if (row.checkout_session_id) {
          let session = await stripe.get(`/v1/checkout/sessions/${encodeURIComponent(row.checkout_session_id)}`, {
            stripeAccount: row.stripe_account_id,
          });
          if (session.status === 'open') {
            session = await stripe.post(`/v1/checkout/sessions/${encodeURIComponent(row.checkout_session_id)}/expire`, {
              stripeAccount: row.stripe_account_id, idempotencyKey: `expire-${row.checkout_session_id}`,
            });
          }
          if (session.status === 'complete') await fulfilCheckoutSession(session, row.stripe_account_id);
          else await db.rpc('payments_release', {
            p_account: row.stripe_account_id, p_checkout_session_id: row.checkout_session_id, p_payment_id: null,
            p_reason: 'checkout_expired',
          });
        } else {
          await db.rpc('payments_release', {
            p_account: row.stripe_account_id, p_checkout_session_id: null, p_payment_id: row.payment_id,
            p_reason: 'checkout_not_created',
          });
        }
        summary.reservations += 1;
      } catch (error) {
        summary.errors += 1;
        log('error', 'reconcile.reservation_failed', { payment_id: row.payment_id, code: error.code || error.name });
      }
    }

    for (const row of (await db.rpc('payments_unfinished_refunds', { p_limit: 50 })) || []) {
      try {
        await executeRefund(row);
        summary.refunds += 1;
      } catch (error) {
        summary.errors += 1;
        log('error', 'reconcile.refund_failed', { refund_id: row.refund_id, code: error.code || error.name });
      }
    }

    for (const row of (await db.rpc('payments_unprocessed_events', { p_limit: 50 })) || []) {
      try {
        const event = await stripe.get(`/v1/events/${encodeURIComponent(row.event_id)}`, { stripeAccount: row.account });
        if (!event.account) event.account = row.account;
        await handleEvent(event);
        summary.events += 1;
      } catch (error) {
        summary.errors += 1;
        log('error', 'reconcile.event_failed', { event_id: row.event_id, code: error.code || error.name });
      }
    }

    await db.rpc('payments_audit', { p_actor: null, p_action: 'job.reconcile.finished', p_entity: 'job', p_entity_id: 'reconcile', p_metadata: summary });
    if (summary.errors > 0) log('error', 'reconcile.completed_with_errors', summary);
    return summary;
  }

  return {
    onboardHost, hostStatus, hostOverview, createSession, listSessions, myBookings,
    startCheckout, checkoutReturn, cancelBooking, cancelSession, refundBooking,
    fulfilCheckoutSession, handleEvent, processEvent, reconcile,
  };
}
