-- JimmiPlay Payments v1, part 2: atomic payment operations.
--
-- Every state change that touches seats or money runs inside one of these functions,
-- so each change is a single database transaction with row locks:
--   sessions row  FOR UPDATE  -> serialises seat allocation per session
--   payments row  FOR UPDATE  -> serialises fulfilment and refunds per payment
-- The server calls them through the Supabase Data API (/rest/v1/rpc/...) with the
-- secret key. EXECUTE is revoked from anon/authenticated, so browsers cannot call them.
--
-- Schema changes in this file (flagged in the PR):
--   bookings.status   + 'late_paid', 'refund_pending'
--   payments          + checkout_url, checkout_expires_at, last_error
--   hosts             + capabilities
--   disputes          + stripe_account_id, livemode, payment_intent_id, charge_id

alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (status in (
  'reserved', 'confirmed', 'expired', 'cancelled', 'refund_pending',
  'cancelled_refunded', 'late_paid', 'late_paid_refunded'
));

alter table public.payments
  add column checkout_url text,
  add column checkout_expires_at timestamptz,
  add column last_error text;

alter table public.hosts add column capabilities jsonb not null default '{}'::jsonb;

alter table public.disputes
  add column stripe_account_id text,
  add column livemode boolean,
  add column payment_intent_id text,
  add column charge_id text;

create index payments_open_expiry_idx on public.payments (checkout_expires_at)
  where status in ('pending', 'open');
create index refunds_active_idx on public.refunds (created_at)
  where status in ('requested', 'pending', 'requires_action');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- 1% = 100 basis points. Integer half-up rounding to the nearest penny:
-- 1000p -> 10p, 750p -> 8p (7.5 rounds up), 749p -> 7p.
create function public.payments_fee_minor(p_amount_minor integer, p_fee_bps integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((p_amount_minor::bigint * p_fee_bps + 5000) / 10000)::integer
$$;

create function public.payments_audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_metadata jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_log (actor_user_id, action, entity, entity_id, metadata)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Hosts
-- ---------------------------------------------------------------------------

create function public.payments_create_host(p_user_id uuid, p_display_name text, p_host_type text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_host public.hosts;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;
  insert into public.hosts (owner_user_id, display_name, host_type)
  values (p_user_id, trim(p_display_name), p_host_type)
  returning * into v_host;
  perform public.payments_audit(p_user_id, 'host.created', 'host', v_host.id::text,
    jsonb_build_object('host_type', p_host_type));
  return jsonb_build_object('ok', true, 'host_id', v_host.id);
end;
$$;

-- Attach the Stripe account created for this host. Never replaces a different account.
create function public.payments_attach_account(p_host_id uuid, p_account text, p_livemode boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_host public.hosts;
begin
  select * into v_host from public.hosts where id = p_host_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'host_not_found');
  end if;
  if v_host.stripe_account_id is not null and v_host.stripe_account_id <> p_account then
    return jsonb_build_object('ok', false, 'code', 'host_has_other_account');
  end if;
  update public.hosts set stripe_account_id = p_account, livemode = p_livemode where id = p_host_id;
  perform public.payments_audit(v_host.owner_user_id, 'host.account_attached', 'host', p_host_id::text,
    jsonb_build_object('stripe_account_id', p_account, 'livemode', p_livemode));
  return jsonb_build_object('ok', true);
end;
$$;

-- Mirror of the Stripe account state, written from account.updated and onboarding return.
create function public.payments_sync_host(
  p_account text, p_livemode boolean, p_charges_enabled boolean, p_payouts_enabled boolean,
  p_details_submitted boolean, p_requirements jsonb, p_disabled_reason text, p_capabilities jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_host public.hosts;
begin
  select * into v_host from public.hosts where stripe_account_id = p_account for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_account');
  end if;
  if v_host.livemode is distinct from p_livemode then
    return jsonb_build_object('ok', false, 'code', 'livemode_mismatch');
  end if;
  update public.hosts set
    charges_enabled = p_charges_enabled,
    payouts_enabled = p_payouts_enabled,
    details_submitted = p_details_submitted,
    requirements = coalesce(p_requirements, '{}'::jsonb),
    disabled_reason = p_disabled_reason,
    capabilities = coalesce(p_capabilities, '{}'::jsonb)
  where id = v_host.id;
  if v_host.charges_enabled is distinct from p_charges_enabled
     or v_host.payouts_enabled is distinct from p_payouts_enabled then
    perform public.payments_audit(null, 'host.capabilities_changed', 'host', v_host.id::text,
      jsonb_build_object('charges_enabled', p_charges_enabled, 'payouts_enabled', p_payouts_enabled,
                         'disabled_reason', p_disabled_reason));
  end if;
  return jsonb_build_object('ok', true, 'host_id', v_host.id);
end;
$$;

create function public.payments_host_deauthorized(p_account text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_host public.hosts;
begin
  select * into v_host from public.hosts where stripe_account_id = p_account for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_account');
  end if;
  update public.hosts set deauthorized_at = coalesce(deauthorized_at, now()), charges_enabled = false,
    payouts_enabled = false where id = v_host.id;
  perform public.payments_audit(null, 'host.deauthorized', 'host', v_host.id::text,
    jsonb_build_object('stripe_account_id', p_account));
  return jsonb_build_object('ok', true, 'host_id', v_host.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create function public.payments_create_session(
  p_user_id uuid, p_host_id uuid, p_title text, p_venue text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_capacity integer, p_price_minor integer, p_refund_deadline_hours integer,
  p_publish boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_host public.hosts;
  v_session_id uuid;
begin
  select * into v_host from public.hosts where id = p_host_id;
  if not found or v_host.owner_user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_host_owner');
  end if;
  if p_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'starts_in_past');
  end if;
  if p_publish and p_price_minor > 0 and (not v_host.charges_enabled or v_host.deauthorized_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'host_cannot_accept_payments');
  end if;
  insert into public.sessions (host_id, title, venue, starts_at, ends_at, capacity, price_minor,
    refund_deadline_hours, status)
  values (p_host_id, trim(p_title), trim(p_venue), p_starts_at, p_ends_at, p_capacity, p_price_minor,
    p_refund_deadline_hours, case when p_publish then 'published' else 'draft' end)
  returning id into v_session_id;
  perform public.payments_audit(p_user_id, 'session.created', 'session', v_session_id::text,
    jsonb_build_object('published', p_publish, 'price_minor', p_price_minor, 'capacity', p_capacity));
  return jsonb_build_object('ok', true, 'session_id', v_session_id);
end;
$$;

-- Public listing with seats left (reserved + confirmed bookings hold a seat).
create function public.payments_list_sessions()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.starts_at), '[]'::jsonb)
  from (
    select s.id, s.title, s.venue, s.starts_at, s.ends_at, s.capacity, s.price_minor, s.currency,
           s.refund_deadline_hours, h.display_name as host_name, h.host_type,
           (h.charges_enabled and h.deauthorized_at is null) as host_can_accept_payments,
           s.capacity - (select count(*) from public.bookings b
                          where b.session_id = s.id and b.status in ('reserved', 'confirmed'))::integer as seats_left
    from public.sessions s
    join public.hosts h on h.id = s.host_id
    where s.status = 'published' and s.starts_at > now()
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Checkout: reserve a seat, attach the Checkout Session, fulfil, release
-- ---------------------------------------------------------------------------

-- Reserves one seat for p_user_id and creates the payment row. The caller then creates
-- the Checkout Session with idempotency key 'checkout-<payment_id>-<epoch of expires_at>'
-- and expires_at = checkout_expires_at (Stripe accepts 30 minutes to 24 hours).
create function public.payments_reserve_seat(p_session_id uuid, p_user_id uuid, p_fee_bps integer,
  p_hold_minutes integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_host public.hosts;
  v_booking public.bookings;
  v_payment public.payments;
  v_live integer;
  v_fee integer;
  v_expires timestamptz := date_trunc('second', now()) + make_interval(mins => p_hold_minutes);
begin
  if p_hold_minutes < 31 or p_hold_minutes > 1440 then
    return jsonb_build_object('ok', false, 'code', 'invalid_hold');
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'session_not_found');
  end if;
  if v_session.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'session_not_bookable');
  end if;
  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'session_started');
  end if;
  if v_session.price_minor <= 0 then
    return jsonb_build_object('ok', false, 'code', 'free_sessions_not_supported');
  end if;

  select * into v_host from public.hosts where id = v_session.host_id;
  if v_host.stripe_account_id is null or not v_host.charges_enabled or v_host.deauthorized_at is not null then
    return jsonb_build_object('ok', false, 'code', 'host_cannot_accept_payments');
  end if;

  -- An existing live booking for this player and session
  select * into v_booking from public.bookings
   where session_id = p_session_id and user_id = p_user_id and status in ('reserved', 'confirmed')
   for update;
  if found then
    if v_booking.status = 'confirmed' then
      return jsonb_build_object('ok', false, 'code', 'already_booked', 'booking_id', v_booking.id);
    end if;
    select * into v_payment from public.payments where booking_id = v_booking.id for update;
    if v_payment.status = 'processing' then
      return jsonb_build_object('ok', false, 'code', 'payment_processing', 'booking_id', v_booking.id);
    end if;
    if v_payment.checkout_url is not null and v_payment.checkout_expires_at > now() + interval '2 minutes' then
      -- Reuse the open Checkout Session: never create a second one for the same seat.
      return jsonb_build_object('ok', true, 'reuse', true, 'booking_id', v_booking.id,
        'payment_id', v_payment.id, 'checkout_url', v_payment.checkout_url);
    end if;
    if v_payment.checkout_session_id is null and v_payment.checkout_expires_at > now() + interval '30 minutes' then
      -- Checkout creation did not complete: retry with identical parameters and key.
      return jsonb_build_object('ok', true, 'reuse', false, 'booking_id', v_booking.id,
        'payment_id', v_payment.id, 'amount_minor', v_payment.amount_minor,
        'application_fee_minor', v_payment.application_fee_minor, 'currency', v_payment.currency,
        'stripe_account_id', v_payment.stripe_account_id, 'livemode', v_payment.livemode,
        'title', v_session.title, 'checkout_expires_at', v_payment.checkout_expires_at);
    end if;
    -- Reservation about to lapse: the reconcile job releases it; ask the player to retry shortly.
    return jsonb_build_object('ok', false, 'code', 'reservation_expiring', 'booking_id', v_booking.id);
  end if;

  select count(*) into v_live from public.bookings
   where session_id = p_session_id and status in ('reserved', 'confirmed');
  if v_live >= v_session.capacity then
    return jsonb_build_object('ok', false, 'code', 'session_full');
  end if;

  v_fee := public.payments_fee_minor(v_session.price_minor, p_fee_bps);
  if v_fee >= v_session.price_minor then
    return jsonb_build_object('ok', false, 'code', 'fee_not_less_than_price');
  end if;

  insert into public.bookings (session_id, user_id, status, reserved_until)
  values (p_session_id, p_user_id, 'reserved', v_expires)
  returning * into v_booking;

  insert into public.payments (booking_id, host_id, stripe_account_id, livemode, amount_minor, currency,
    application_fee_minor, status, checkout_expires_at)
  values (v_booking.id, v_host.id, v_host.stripe_account_id, v_host.livemode, v_session.price_minor,
    v_session.currency, v_fee, 'pending', v_expires)
  returning * into v_payment;

  perform public.payments_audit(p_user_id, 'booking.reserved', 'booking', v_booking.id::text,
    jsonb_build_object('session_id', p_session_id, 'payment_id', v_payment.id, 'amount_minor',
      v_payment.amount_minor, 'application_fee_minor', v_fee));

  return jsonb_build_object('ok', true, 'reuse', false, 'booking_id', v_booking.id,
    'payment_id', v_payment.id, 'amount_minor', v_payment.amount_minor,
    'application_fee_minor', v_fee, 'currency', v_payment.currency,
    'stripe_account_id', v_payment.stripe_account_id, 'livemode', v_payment.livemode,
    'title', v_session.title, 'checkout_expires_at', v_payment.checkout_expires_at);
end;
$$;

create function public.payments_attach_checkout(p_payment_id uuid, p_checkout_session_id text, p_url text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_not_found');
  end if;
  if v_payment.checkout_session_id is not null and v_payment.checkout_session_id <> p_checkout_session_id then
    return jsonb_build_object('ok', false, 'code', 'payment_has_other_checkout');
  end if;
  update public.payments set checkout_session_id = p_checkout_session_id, checkout_url = p_url,
    status = case when status = 'pending' then 'open' else status end, last_error = null
  where id = p_payment_id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.payments_record_checkout_error(p_payment_id uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.payments set last_error = left(p_error, 500) where id = p_payment_id
$$;

-- Applies authoritative Checkout Session evidence (webhook or server-side retrieve).
-- Idempotent: repeated or out-of-order calls converge on one state.
-- Result codes: confirmed, already_confirmed, processing, not_paid, refund_required,
-- duplicate_payment, unknown_payment, account_mismatch, livemode_mismatch, amount_mismatch.
create function public.payments_fulfil(
  p_account text, p_livemode boolean, p_checkout_session_id text, p_booking_id uuid,
  p_payment_status text, p_payment_intent_id text, p_amount_total integer, p_currency text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_booking public.bookings;
  v_session public.sessions;
  v_live integer;
begin
  select * into v_payment from public.payments where checkout_session_id = p_checkout_session_id for update;
  if not found then
    if p_booking_id is null then
      return jsonb_build_object('ok', false, 'code', 'unknown_payment');
    end if;
    select * into v_payment from public.payments where booking_id = p_booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'unknown_payment');
    end if;
    if v_payment.checkout_session_id is not null and v_payment.checkout_session_id <> p_checkout_session_id then
      -- A second Checkout Session was paid for a booking that already has one.
      return jsonb_build_object('ok', false, 'code', 'duplicate_payment', 'payment_id', v_payment.id,
        'stripe_account_id', v_payment.stripe_account_id);
    end if;
    update public.payments set checkout_session_id = p_checkout_session_id where id = v_payment.id;
  end if;

  if v_payment.stripe_account_id <> p_account then
    return jsonb_build_object('ok', false, 'code', 'account_mismatch');
  end if;
  if v_payment.livemode <> p_livemode then
    return jsonb_build_object('ok', false, 'code', 'livemode_mismatch');
  end if;
  if p_amount_total is distinct from v_payment.amount_minor or lower(p_currency) <> v_payment.currency then
    update public.payments set last_error = 'amount_mismatch' where id = v_payment.id;
    perform public.payments_audit(null, 'payment.amount_mismatch', 'payment', v_payment.id::text,
      jsonb_build_object('expected', v_payment.amount_minor, 'received', p_amount_total, 'currency', p_currency));
    return jsonb_build_object('ok', false, 'code', 'amount_mismatch', 'payment_id', v_payment.id);
  end if;

  if p_payment_status = 'unpaid' then
    update public.payments set status = 'processing',
      payment_intent_id = coalesce(payment_intent_id, p_payment_intent_id)
    where id = v_payment.id and status in ('pending', 'open');
    return jsonb_build_object('ok', true, 'code', 'processing', 'booking_id', v_payment.booking_id);
  end if;
  if p_payment_status <> 'paid' then
    return jsonb_build_object('ok', true, 'code', 'not_paid', 'booking_id', v_payment.booking_id);
  end if;

  if v_payment.status <> 'succeeded' then
    update public.payments set status = 'succeeded',
      payment_intent_id = coalesce(payment_intent_id, p_payment_intent_id), last_error = null
    where id = v_payment.id;
    perform public.payments_audit(null, 'payment.succeeded', 'payment', v_payment.id::text,
      jsonb_build_object('payment_intent_id', p_payment_intent_id, 'stripe_account_id', p_account));
  end if;

  select * into v_booking from public.bookings where id = v_payment.booking_id;
  select * into v_session from public.sessions where id = v_booking.session_id for update;
  select * into v_booking from public.bookings where id = v_payment.booking_id for update;

  if v_booking.status = 'reserved' then
    update public.bookings set status = 'confirmed', reserved_until = null where id = v_booking.id;
    perform public.payments_audit(v_booking.user_id, 'booking.confirmed', 'booking', v_booking.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'code', 'confirmed', 'booking_id', v_booking.id);
  end if;
  if v_booking.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'code', 'already_confirmed', 'booking_id', v_booking.id);
  end if;
  if v_booking.status = 'expired' then
    -- Late payment: confirm only if a seat is still free; never displace a valid booking.
    select count(*) into v_live from public.bookings
     where session_id = v_session.id and status in ('reserved', 'confirmed');
    if v_session.status = 'published' and v_session.starts_at > now() and v_live < v_session.capacity
       and not exists (select 1 from public.bookings where session_id = v_session.id
                        and user_id = v_booking.user_id and status in ('reserved', 'confirmed')) then
      update public.bookings set status = 'confirmed', reserved_until = null where id = v_booking.id;
      perform public.payments_audit(v_booking.user_id, 'booking.confirmed_late', 'booking', v_booking.id::text, '{}'::jsonb);
      return jsonb_build_object('ok', true, 'code', 'confirmed', 'booking_id', v_booking.id);
    end if;
    update public.bookings set status = 'late_paid' where id = v_booking.id;
    perform public.payments_audit(v_booking.user_id, 'booking.late_paid', 'booking', v_booking.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'code', 'refund_required', 'booking_id', v_booking.id);
  end if;
  if v_booking.status = 'late_paid' then
    return jsonb_build_object('ok', true, 'code', 'refund_required', 'booking_id', v_booking.id);
  end if;
  return jsonb_build_object('ok', true, 'code', 'already_final', 'booking_id', v_booking.id,
    'booking_status', v_booking.status);
end;
$$;

-- Releases the seat of an unpaid reservation (Checkout Session expired or delayed payment failed).
create function public.payments_release(p_account text, p_checkout_session_id text, p_payment_id uuid,
  p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_booking public.bookings;
begin
  if p_checkout_session_id is not null then
    select * into v_payment from public.payments where checkout_session_id = p_checkout_session_id for update;
  else
    select * into v_payment from public.payments where id = p_payment_id for update;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_payment');
  end if;
  if p_account is not null and v_payment.stripe_account_id <> p_account then
    return jsonb_build_object('ok', false, 'code', 'account_mismatch');
  end if;
  if v_payment.status = 'succeeded' then
    return jsonb_build_object('ok', true, 'code', 'already_paid');
  end if;
  if v_payment.status = 'processing' and p_reason <> 'async_payment_failed' then
    return jsonb_build_object('ok', true, 'code', 'still_processing');
  end if;
  update public.payments
     set status = case when p_reason = 'async_payment_failed' then 'failed' else 'expired' end
   where id = v_payment.id and status in ('pending', 'open', 'processing');

  select * into v_booking from public.bookings where id = v_payment.booking_id for update;
  if v_booking.status = 'reserved' then
    update public.bookings set status = 'expired', reserved_until = null where id = v_booking.id;
    perform public.payments_audit(v_booking.user_id, 'booking.released', 'booking', v_booking.id::text,
      jsonb_build_object('reason', p_reason));
  end if;
  return jsonb_build_object('ok', true, 'code', 'released', 'booking_id', v_booking.id);
end;
$$;

-- Reservations whose Checkout Session should have ended (for the reconcile job).
create function public.payments_stale_reservations(p_limit integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select p.id as payment_id, p.booking_id, p.stripe_account_id, p.checkout_session_id, p.checkout_expires_at
      from public.payments p
     where p.status in ('pending', 'open') and p.checkout_expires_at < now() - interval '5 minutes'
     order by p.checkout_expires_at
     limit p_limit
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

-- Records the intent to refund before Stripe is called. The refund row id is the
-- idempotency key. p_mode: player_cancel | host_cancel | late_payment.
create function public.payments_request_refund(p_booking_id uuid, p_actor uuid, p_mode text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_session public.sessions;
  v_payment public.payments;
  v_refund public.refunds;
  v_refunded integer;
  v_remaining integer;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'booking_not_found');
  end if;
  select * into v_session from public.sessions where id = v_booking.session_id for update;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  select * into v_payment from public.payments where booking_id = p_booking_id for update;
  if not found or v_payment.status <> 'succeeded' then
    return jsonb_build_object('ok', false, 'code', 'no_successful_payment');
  end if;

  if p_mode = 'player_cancel' then
    if v_booking.user_id <> p_actor then
      return jsonb_build_object('ok', false, 'code', 'not_booking_owner');
    end if;
    if v_booking.status not in ('confirmed', 'refund_pending') then
      return jsonb_build_object('ok', false, 'code', 'booking_not_refundable', 'booking_status', v_booking.status);
    end if;
    if v_booking.status = 'confirmed'
       and now() > v_session.starts_at - make_interval(hours => v_session.refund_deadline_hours) then
      return jsonb_build_object('ok', false, 'code', 'refund_deadline_passed');
    end if;
  elsif p_mode = 'host_cancel' then
    if not exists (select 1 from public.hosts h where h.id = v_session.host_id and h.owner_user_id = p_actor) then
      return jsonb_build_object('ok', false, 'code', 'not_host_owner');
    end if;
    if v_booking.status not in ('confirmed', 'refund_pending', 'late_paid') then
      return jsonb_build_object('ok', false, 'code', 'booking_not_refundable', 'booking_status', v_booking.status);
    end if;
  elsif p_mode = 'late_payment' then
    if v_booking.status <> 'late_paid' then
      return jsonb_build_object('ok', false, 'code', 'booking_not_refundable', 'booking_status', v_booking.status);
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_mode');
  end if;

  if exists (select 1 from public.disputes d where d.payment_id = v_payment.id
              and d.status not in ('won', 'lost', 'warning_closed')) then
    return jsonb_build_object('ok', false, 'code', 'payment_disputed');
  end if;

  -- An unfinished refund already exists: return it instead of creating a second one.
  select * into v_refund from public.refunds
   where payment_id = v_payment.id and status in ('requested', 'pending', 'requires_action')
   order by created_at limit 1;
  if found then
    return jsonb_build_object('ok', true, 'existing', true, 'refund_id', v_refund.id,
      'stripe_refund_id', v_refund.stripe_refund_id, 'amount_minor', v_refund.amount_minor,
      'payment_intent_id', v_payment.payment_intent_id, 'stripe_account_id', v_payment.stripe_account_id);
  end if;

  select coalesce(sum(amount_minor), 0) into v_refunded from public.refunds
   where payment_id = v_payment.id and status = 'succeeded';
  v_remaining := v_payment.amount_minor - v_refunded;
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'code', 'already_refunded');
  end if;

  insert into public.refunds (payment_id, amount_minor, refund_application_fee, origin, status, reason, requested_by)
  values (v_payment.id, v_remaining, true, 'jimmiplay', 'requested', p_mode, p_actor)
  returning * into v_refund;

  if v_booking.status = 'confirmed' then
    update public.bookings set status = 'refund_pending' where id = v_booking.id;
  end if;

  perform public.payments_audit(p_actor, 'refund.requested', 'refund', v_refund.id::text,
    jsonb_build_object('booking_id', p_booking_id, 'mode', p_mode, 'amount_minor', v_remaining));

  return jsonb_build_object('ok', true, 'existing', false, 'refund_id', v_refund.id,
    'stripe_refund_id', null, 'amount_minor', v_remaining,
    'payment_intent_id', v_payment.payment_intent_id, 'stripe_account_id', v_payment.stripe_account_id);
end;
$$;

-- Applies a Stripe refund state (API response, refund.* / charge.refunded webhooks, reconcile).
-- p_refund_id is the local id from metadata.jimmiplay_refund_id when JimmiPlay created it;
-- refunds created in the host's Stripe Dashboard arrive without it and are recorded with
-- origin 'stripe_dashboard'.
create function public.payments_record_refund(
  p_account text, p_livemode boolean, p_payment_intent_id text, p_refund_id uuid,
  p_stripe_refund_id text, p_amount integer, p_status text, p_failure_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_booking public.bookings;
  v_refund public.refunds;
  v_succeeded integer;
begin
  select * into v_payment from public.payments where payment_intent_id = p_payment_intent_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_payment');
  end if;
  if v_payment.stripe_account_id <> p_account then
    return jsonb_build_object('ok', false, 'code', 'account_mismatch');
  end if;
  if v_payment.livemode <> p_livemode then
    return jsonb_build_object('ok', false, 'code', 'livemode_mismatch');
  end if;

  select * into v_refund from public.refunds where stripe_refund_id = p_stripe_refund_id for update;
  if not found and p_refund_id is not null then
    select * into v_refund from public.refunds where id = p_refund_id and payment_id = v_payment.id for update;
  end if;

  if found then
    update public.refunds set stripe_refund_id = p_stripe_refund_id, status = p_status,
      failure_reason = p_failure_reason
    where id = v_refund.id
      -- a final state never moves back to an earlier one
      and not (status in ('succeeded', 'failed', 'canceled') and p_status in ('requested', 'pending', 'requires_action'));
  else
    insert into public.refunds (payment_id, stripe_refund_id, amount_minor, refund_application_fee, origin,
      status, failure_reason, reason)
    values (v_payment.id, p_stripe_refund_id, p_amount, false, 'stripe_dashboard', p_status, p_failure_reason,
      'created_outside_jimmiplay')
    returning * into v_refund;
    perform public.payments_audit(null, 'refund.external_recorded', 'refund', v_refund.id::text,
      jsonb_build_object('stripe_refund_id', p_stripe_refund_id, 'amount_minor', p_amount));
  end if;

  select coalesce(sum(amount_minor), 0) into v_succeeded from public.refunds
   where payment_id = v_payment.id and status = 'succeeded';
  select * into v_booking from public.bookings where id = v_payment.booking_id for update;
  if v_succeeded >= v_payment.amount_minor then
    if v_booking.status in ('confirmed', 'refund_pending') then
      update public.bookings set status = 'cancelled_refunded' where id = v_booking.id;
    elsif v_booking.status = 'late_paid' then
      update public.bookings set status = 'late_paid_refunded' where id = v_booking.id;
    end if;
  end if;
  if p_status in ('failed', 'canceled') then
    perform public.payments_audit(null, 'refund.failed', 'refund', coalesce(v_refund.id::text, p_stripe_refund_id),
      jsonb_build_object('status', p_status, 'failure_reason', p_failure_reason));
  end if;
  return jsonb_build_object('ok', true, 'booking_id', v_booking.id,
    'booking_status', (select status from public.bookings where id = v_booking.id),
    'refunded_minor', v_succeeded);
end;
$$;

-- Refunds that have not reached a final state (for the reconcile job).
create function public.payments_unfinished_refunds(p_limit integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select r.id as refund_id, r.stripe_refund_id, r.amount_minor, r.status, p.payment_intent_id,
           p.stripe_account_id, p.livemode
      from public.refunds r join public.payments p on p.id = r.payment_id
     where r.origin = 'jimmiplay' and r.status in ('requested', 'pending', 'requires_action')
       and r.updated_at < now() - interval '2 minutes'
     order by r.created_at
     limit p_limit
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Session cancellation by the host
-- ---------------------------------------------------------------------------

-- Cancels the session, releases unpaid reservations and returns what the server must do
-- next: expire open Checkout Sessions and refund paid bookings.
create function public.payments_cancel_session(p_session_id uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_open jsonb;
  v_paid jsonb;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'session_not_found');
  end if;
  if not exists (select 1 from public.hosts h where h.id = v_session.host_id and h.owner_user_id = p_actor) then
    return jsonb_build_object('ok', false, 'code', 'not_host_owner');
  end if;
  update public.sessions set status = 'cancelled' where id = p_session_id;

  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id, 'checkout_session_id', p.checkout_session_id,
           'stripe_account_id', p.stripe_account_id)), '[]'::jsonb)
    into v_open
    from public.bookings b join public.payments p on p.booking_id = b.id
   where b.session_id = p_session_id and b.status = 'reserved' and p.status in ('pending', 'open');

  select coalesce(jsonb_agg(b.id), '[]'::jsonb) into v_paid
    from public.bookings b join public.payments p on p.booking_id = b.id
   where b.session_id = p_session_id and b.status in ('confirmed', 'refund_pending', 'late_paid')
     and p.status = 'succeeded';

  perform public.payments_audit(p_actor, 'session.cancelled', 'session', p_session_id::text,
    jsonb_build_object('open_checkouts', jsonb_array_length(v_open), 'paid_bookings', jsonb_array_length(v_paid)));
  return jsonb_build_object('ok', true, 'open_checkouts', v_open, 'paid_booking_ids', v_paid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

create function public.payments_record_dispute(
  p_account text, p_livemode boolean, p_dispute_id text, p_payment_intent_id text, p_charge_id text,
  p_status text, p_reason text, p_amount integer, p_evidence_due_by timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where payment_intent_id = p_payment_intent_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_payment');
  end if;
  if v_payment.stripe_account_id <> p_account then
    return jsonb_build_object('ok', false, 'code', 'account_mismatch');
  end if;
  insert into public.disputes (stripe_dispute_id, payment_id, status, reason, amount_minor, evidence_due_by,
    stripe_account_id, livemode, payment_intent_id, charge_id)
  values (p_dispute_id, v_payment.id, p_status, p_reason, p_amount, p_evidence_due_by, p_account, p_livemode,
    p_payment_intent_id, p_charge_id)
  on conflict (stripe_dispute_id) do update set status = excluded.status, reason = excluded.reason,
    amount_minor = excluded.amount_minor, evidence_due_by = excluded.evidence_due_by;
  perform public.payments_audit(null, 'dispute.' || p_status, 'dispute', p_dispute_id,
    jsonb_build_object('payment_id', v_payment.id, 'amount_minor', p_amount, 'evidence_due_by', p_evidence_due_by));
  return jsonb_build_object('ok', true, 'payment_id', v_payment.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook event bookkeeping
-- ---------------------------------------------------------------------------

-- Returns 'new', 'retry' (seen before but not finished) or 'done' (already processed).
create function public.payments_begin_event(p_event_id text, p_type text, p_account text, p_livemode boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_processed timestamptz;
begin
  insert into public.stripe_events (event_id, type, account, livemode, attempts)
  values (p_event_id, p_type, p_account, p_livemode, 1)
  on conflict (event_id) do nothing;
  if found then
    return 'new';
  end if;
  select processed_at into v_processed from public.stripe_events where event_id = p_event_id for update;
  if v_processed is not null then
    return 'done';
  end if;
  update public.stripe_events set attempts = attempts + 1 where event_id = p_event_id;
  return 'retry';
end;
$$;

create function public.payments_finish_event(p_event_id text, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.stripe_events
     set processed_at = case when p_error is null then now() else null end,
         last_error = case when p_error is null then null else left(p_error, 500) end
   where event_id = p_event_id
$$;

-- ---------------------------------------------------------------------------
-- Read models for the UI
-- ---------------------------------------------------------------------------

create function public.payments_my_bookings(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) from (
    select b.id, b.status, b.created_at, b.reserved_until,
           s.id as session_id, s.title, s.venue, s.starts_at, s.refund_deadline_hours, s.status as session_status,
           h.display_name as host_name,
           p.status as payment_status, p.amount_minor, p.currency, p.checkout_url,
           (s.starts_at - make_interval(hours => s.refund_deadline_hours)) as refund_deadline,
           (select coalesce(jsonb_agg(jsonb_build_object('status', r.status, 'amount_minor', r.amount_minor,
                    'origin', r.origin, 'failure_reason', r.failure_reason, 'created_at', r.created_at)
                    order by r.created_at), '[]'::jsonb)
              from public.refunds r where r.payment_id = p.id) as refunds
      from public.bookings b
      join public.sessions s on s.id = b.session_id
      join public.hosts h on h.id = s.host_id
      left join public.payments p on p.booking_id = b.id
     where b.user_id = p_user_id
  ) t
$$;

create function public.payments_host_overview(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb) from (
    select h.id, h.display_name, h.host_type, h.stripe_account_id, h.charges_enabled, h.payouts_enabled,
           h.details_submitted, h.requirements, h.disabled_reason, h.deauthorized_at, h.created_at,
           (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'venue', s.venue, 'starts_at', s.starts_at, 'status', s.status,
                'capacity', s.capacity, 'price_minor', s.price_minor,
                'confirmed', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'confirmed'),
                'reserved', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'reserved'),
                'gross_minor', (select coalesce(sum(p.amount_minor), 0) from public.payments p
                                  join public.bookings b on b.id = p.booking_id
                                 where b.session_id = s.id and p.status = 'succeeded'),
                'fees_minor', (select coalesce(sum(p.application_fee_minor), 0) from public.payments p
                                 join public.bookings b on b.id = p.booking_id
                                where b.session_id = s.id and p.status = 'succeeded'),
                'refunded_minor', (select coalesce(sum(r.amount_minor), 0) from public.refunds r
                                     join public.payments p on p.id = r.payment_id
                                     join public.bookings b on b.id = p.booking_id
                                    where b.session_id = s.id and r.status = 'succeeded'),
                'open_disputes', (select count(*) from public.disputes d join public.payments p on p.id = d.payment_id
                                    join public.bookings b on b.id = p.booking_id
                                   where b.session_id = s.id and d.status not in ('won', 'lost', 'warning_closed'))
              ) order by s.starts_at), '[]'::jsonb)
              from public.sessions s where s.host_id = h.id) as sessions
      from public.hosts h
     where h.owner_user_id = p_user_id
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Permissions: server-only (secret key = service_role)
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'payments\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
