-- JimmiPlay Payments v1, part 4: alignment with JIMMI_PAYMENT_ONBOARDING_SPEC.md
--   §11  "How is this Club operated?" stored as hosts.payment_entity_type (Jimmi metadata;
--        Stripe stays the source of truth for legal/KYC status).
--   §2.1 Full name captured at registration (Supabase Auth user metadata -> profiles.display_name).

alter table public.hosts add column payment_entity_type text
  check (payment_entity_type in ('individual', 'company', 'organisation'));

drop function public.payments_create_host(uuid, text, text);

create function public.payments_create_host(p_user_id uuid, p_display_name text, p_host_type text,
  p_payment_entity_type text)
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
  insert into public.hosts (owner_user_id, display_name, host_type, payment_entity_type)
  values (p_user_id, trim(p_display_name), p_host_type, p_payment_entity_type)
  returning * into v_host;
  perform public.payments_audit(p_user_id, 'host.created', 'host', v_host.id::text,
    jsonb_build_object('host_type', p_host_type, 'payment_entity_type', p_payment_entity_type));
  return jsonb_build_object('ok', true, 'host_id', v_host.id);
end;
$$;

revoke all on function public.payments_create_host(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.payments_create_host(uuid, text, text, text) to service_role;

-- Overview now also returns payment_entity_type.
create or replace function public.payments_host_overview(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb) from (
    select h.id, h.display_name, h.host_type, h.payment_entity_type, h.stripe_account_id, h.charges_enabled,
           h.payouts_enabled, h.details_submitted, h.requirements, h.disabled_reason, h.deauthorized_at, h.created_at,
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

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
