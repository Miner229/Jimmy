-- JimmiPlay Payments v1, part 3: lookups used by the checkout return page and the reconcile job.

-- Account context for a Checkout Session, only if the booking belongs to p_user_id.
create function public.payments_checkout_context(p_user_id uuid, p_checkout_session_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'booking_id', b.id, 'payment_id', p.id,
                              'stripe_account_id', p.stripe_account_id, 'livemode', p.livemode)
      from public.payments p join public.bookings b on b.id = p.booking_id
     where p.checkout_session_id = p_checkout_session_id and b.user_id = p_user_id
  ), jsonb_build_object('ok', false, 'code', 'not_found'))
$$;

-- Webhook events that were received but not processed successfully (for the reconcile job).
create function public.payments_unprocessed_events(p_limit integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select e.event_id, e.type, e.account, e.livemode, e.attempts, e.last_error, e.received_at
      from public.stripe_events e
     where e.processed_at is null and e.received_at < now() - interval '5 minutes'
       and e.received_at > now() - interval '30 days'
     order by e.received_at
     limit p_limit
  ) t
$$;

revoke all on function public.payments_checkout_context(uuid, text) from public, anon, authenticated;
grant execute on function public.payments_checkout_context(uuid, text) to service_role;
revoke all on function public.payments_unprocessed_events(integer) from public, anon, authenticated;
grant execute on function public.payments_unprocessed_events(integer) to service_role;
