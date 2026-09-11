-- Additive schema for the Jimmy React/Vercel repository (no prior database).
-- Run on a Supabase PostgreSQL database; auth.users remains the identity source.
create table if not exists users (
 id uuid primary key, full_name text not null, email text not null,
 email_verified_at timestamptz, status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now()
);
create table clubs (
 id uuid primary key, name text not null, primary_sport text not null, main_area text not null,
 status text not null default 'active' check(status in ('active','archived')),
 created_by_user_id uuid not null references users(id), payment_entity_type text check(payment_entity_type in ('individual','company','organisation')),
 organisation_subtype text, created_at timestamptz not null default now()
);
create table club_memberships (
 id uuid primary key, club_id uuid not null references clubs(id), user_id uuid not null references users(id),
 role text not null check(role in ('Owner','Admin','Organizer')), status text not null default 'active' check(status in ('active','removed')),
 invited_by_user_id uuid references users(id), joined_at timestamptz not null default now(), unique(club_id,user_id)
);
create unique index one_active_owner on club_memberships(club_id) where role='Owner' and status='active';
create table club_invitations (
 id uuid primary key, club_id uuid not null references clubs(id), email text not null, intended_role text not null check(intended_role in ('Admin','Organizer')),
 token_hash text not null unique, expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz,
 invited_by_user_id uuid not null references users(id), created_at timestamptz not null default now()
);
create table sessions (
 id uuid primary key, club_id uuid not null references clubs(id), created_by_user_id uuid not null references users(id),
 organizer_user_id uuid not null references users(id), title text not null, venue text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 capacity integer not null check(capacity between 1 and 1000), price integer not null check(price between 0 and 1000000), currency text not null default 'gbp' check(currency='gbp'),
 status text not null default 'draft' check(status in ('draft','published','cancelled','deleted')), cancellation_hours integer not null default 12 check(cancellation_hours>=-1),
 details jsonb not null default '{}', created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table payment_accounts (
 id uuid primary key, club_id uuid not null references clubs(id), provider text not null default 'stripe' check(provider='stripe'),
 provider_account_id text unique, active boolean not null default true, onboarding_status text not null default 'NOT_STARTED',
 payments_enabled boolean not null default false, payouts_enabled boolean not null default false, legal_entity_type text,
 requirements jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_payment_account on payment_accounts(club_id) where active;
create table payout_destinations (
 id uuid primary key, payment_account_id uuid not null references payment_accounts(id), provider_reference text not null unique,
 bank_display_name text, last4 text check(length(last4)=4), status text not null, active boolean not null default false,
 updated_at timestamptz not null default now()
);
create unique index one_active_payout_destination on payout_destinations(payment_account_id) where active;
create table bookings (
 id uuid primary key, club_id uuid not null references clubs(id), session_id uuid not null references sessions(id), user_id uuid not null references users(id),
 status text not null check(status in ('pending','confirmed','cancelled','refunded','failed')), expires_at timestamptz,
 checkout_id text unique, checkout_url text, created_at timestamptz not null default now()
);
create unique index one_live_booking on bookings(session_id,user_id) where status in ('pending','confirmed');
create table booking_transactions (
 id uuid primary key, club_id uuid not null references clubs(id), session_id uuid not null references sessions(id), booking_id uuid not null unique references bookings(id),
 payment_account_id uuid not null references payment_accounts(id), provider_payment_id text unique,
 gross_amount integer not null check(gross_amount>=0), platform_fee integer not null default 0 check(platform_fee>=0), provider_fee integer,
 payment_status text not null default 'pending', refund_status text not null default 'none', dispute_status text not null default 'none', created_at timestamptz not null default now()
);
create table refunds (
 id uuid primary key, transaction_id uuid not null references booking_transactions(id), actor_user_id uuid not null references users(id),
 amount integer not null check(amount>0), reason text not null, provider_refund_id text unique, status text not null default 'pending', created_at timestamptz not null default now()
);
create unique index one_full_refund on refunds(transaction_id) where status not in ('failed','canceled');
create table disputes (
 provider_dispute_id text primary key, transaction_id uuid not null references booking_transactions(id), club_id uuid not null references clubs(id),
 status text not null, amount integer not null, updated_at timestamptz not null default now()
);
create table payouts (
 provider_payout_id text primary key, club_id uuid not null references clubs(id), payment_account_id uuid not null references payment_accounts(id),
 amount integer not null, currency text not null, status text not null, failure_code text, updated_at timestamptz not null default now()
);
create table audit_events (
 id uuid primary key, actor_user_id uuid references users(id), club_id uuid references clubs(id), event_type text not null, target text,
 metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table provider_events (
 provider_event_id text primary key, event_type text not null, account_id text, processed_at timestamptz not null default now()
);
create table step_up_tokens (
 token_hash text primary key, user_id uuid not null references users(id), club_id uuid not null references clubs(id), expires_at timestamptz not null, used_at timestamptz
);
create table payout_changes (
 id uuid primary key, club_id uuid not null references clubs(id), payment_account_id uuid not null references payment_accounts(id), actor_user_id uuid not null references users(id),
 status text not null default 'requested' check(status in ('requested','holding','completed')), previous_reference text, new_reference text,
 hold_until timestamptz not null, created_at timestamptz not null default now(), approvals_required integer not null default 1,
 completed_at timestamptz
);
create unique index one_pending_payout_change on payout_changes(club_id) where status!='completed';
create table email_outbox (
 id uuid primary key, recipient text not null, subject text not null, body text not null, sent_at timestamptz, attempts integer not null default 0,
 created_at timestamptz not null default now()
);
create table rate_limits (key text primary key, hits integer not null, expires_at timestamptz not null);
create table risk_flags (
 id uuid primary key, club_id uuid not null references clubs(id), signal text not null, status text not null default 'review', created_at timestamptz not null default now()
);
-- No browser may mutate/read these tables directly. All access is through the
-- server API with per-request authenticated membership authorization.
do $$ declare t text; begin
 foreach t in array array['users','clubs','club_memberships','club_invitations','sessions','payment_accounts','payout_destinations','bookings','booking_transactions','refunds','disputes','payouts','audit_events','provider_events','step_up_tokens','payout_changes','email_outbox','rate_limits','risk_flags'] loop
 execute format('alter table %I enable row level security', t);
 end loop;
end $$;
-- Enforce financial Club consistency independently of application checks.
alter table sessions add unique(id,club_id);
alter table payment_accounts add unique(id,club_id);
alter table bookings add unique(id,club_id,session_id);
alter table bookings add foreign key(session_id,club_id) references sessions(id,club_id);
alter table booking_transactions add foreign key(booking_id,club_id,session_id) references bookings(id,club_id,session_id);
alter table booking_transactions add foreign key(payment_account_id,club_id) references payment_accounts(id,club_id);
alter table bookings add column attended boolean not null default false;
alter table payout_destinations add column fingerprint_hash text;
