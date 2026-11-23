-- JimmiPlay Payments v1: Stripe Connect Direct Charges (Accounts v1, full Dashboard hosts).
-- Additive schema for a Supabase Postgres database. Apply to TEST projects only until
-- production deployment is explicitly approved.
--
-- Conventions
--   * Money is stored in integer minor units (pence). Currency is GBP only in v1.
--   * Every Stripe object ID is stored next to the connected account ID and livemode,
--     because direct-charge objects live on the connected account.
--   * Row Level Security is enabled with no policies: browsers cannot read or write these
--     tables through the Supabase Data API. All access goes through the server API,
--     which connects with DATABASE_URL and performs its own authorization.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- A host is a club or an individual organiser. One owner per host; a user may own
-- several hosts and can still book sessions as a player.
create table public.hosts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id),
  display_name text not null check (length(display_name) between 1 and 120),
  host_type text not null check (host_type in ('club', 'individual')),
  stripe_account_id text unique,
  livemode boolean,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements jsonb not null default '{}'::jsonb,
  disabled_reason text,
  deauthorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hosts_owner_user_id_idx on public.hosts (owner_user_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts (id),
  title text not null check (length(title) between 1 and 200),
  venue text not null check (length(venue) between 1 and 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 1000),
  price_minor integer not null check (price_minor between 0 and 1000000),
  currency text not null default 'gbp' check (currency = 'gbp'),
  refund_deadline_hours integer not null default 24 check (refund_deadline_hours between 0 and 720),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index sessions_host_id_idx on public.sessions (host_id);
create index sessions_published_starts_at_idx on public.sessions (starts_at) where status = 'published';

-- reserved            seat held while the Checkout Session is open
-- confirmed           paid (or free) booking
-- expired             reservation released (Checkout Session expired or async payment failed)
-- cancelled           free booking cancelled
-- cancelled_refunded  paid booking cancelled and fully refunded
-- late_paid_refunded  payment arrived when no seat was available; refunded in full
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  user_id uuid not null references public.profiles (id),
  status text not null check (status in (
    'reserved', 'confirmed', 'expired', 'cancelled', 'cancelled_refunded', 'late_paid_refunded'
  )),
  reserved_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bookings_one_live_per_user_idx
  on public.bookings (session_id, user_id) where status in ('reserved', 'confirmed');
create index bookings_live_by_session_idx
  on public.bookings (session_id) where status in ('reserved', 'confirmed');
create index bookings_user_id_idx on public.bookings (user_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id),
  host_id uuid not null references public.hosts (id),
  stripe_account_id text not null,
  livemode boolean not null,
  checkout_session_id text unique,
  payment_intent_id text unique,
  charge_id text unique,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency = 'gbp'),
  application_fee_minor integer not null check (application_fee_minor >= 0 and application_fee_minor < amount_minor),
  status text not null default 'pending' check (status in (
    'pending', 'open', 'processing', 'succeeded', 'failed', 'expired'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_host_id_idx on public.payments (host_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  stripe_refund_id text unique,
  amount_minor integer not null check (amount_minor > 0),
  refund_application_fee boolean not null,
  origin text not null check (origin in ('jimmiplay', 'stripe_dashboard')),
  status text not null default 'requested' check (status in (
    'requested', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
  )),
  failure_reason text,
  reason text,
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_payment_id_idx on public.refunds (payment_id);

create table public.disputes (
  stripe_dispute_id text primary key,
  payment_id uuid not null references public.payments (id),
  status text not null,
  reason text,
  amount_minor integer not null,
  evidence_due_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index disputes_payment_id_idx on public.disputes (payment_id);

-- One row per Stripe event ID: duplicate deliveries are ignored.
create table public.stripe_events (
  event_id text primary key,
  type text not null,
  account text,
  livemode boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index stripe_events_unprocessed_idx on public.stripe_events (received_at) where processed_at is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- updated_at maintenance
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger hosts_set_updated_at before update on public.hosts
  for each row execute function public.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();
create trigger disputes_set_updated_at before update on public.disputes
  for each row execute function public.set_updated_at();

-- Create a profile for every new Supabase Auth user.
create function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Server-only access: RLS on, no policies.
alter table public.profiles enable row level security;
alter table public.hosts enable row level security;
alter table public.sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.disputes enable row level security;
alter table public.stripe_events enable row level security;
alter table public.audit_log enable row level security;
