# Jimmi payment onboarding implementation

Source of truth: `JIMMI_PAYMENT_ONBOARDING_SPEC.md` v1.0.

## Audit and incremental plan

This is **Miner229/Jimmy**, a Vite/React application deployed on Vercel, not the older Next.js project in its parent directory. There was no persistent database, auth provider or real payment integration to migrate here.

| Existing code                                           | Reuse / change                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.jsx`                                           | Keep navigation, cards, discovery, Club details, rankings, tournaments, court allocation and score UI. Feed live Club/Session records into existing components, with existing demo IDs retained. Replace fake checkout and card collection with hosted Checkout. |
| `src/CreateFlows.jsx`, `src/creation.css`               | Reuse form primitives, Session/Tournament fields and styling. Club form becomes the specified three-field onboarding. Retain coaching registration.                                                                                                              |
| `api/creation/[kind].js`                                | Keep legacy URLs, dispatch Club/Session JSON requests to the canonical platform handler; coaching remains explicitly unconfigured.                                                                                                                               |
| `tests/creation.test.mjs`                               | Update Club requirements; retain Session/Tournament rendering checks.                                                                                                                                                                                            |
| In-memory `CURRENT_USER`, `CLUBS`, `SESSIONS`, bookings | These were demonstrations, not persisted customer data. No invented ownership or KYC status is assigned to demo Clubs. Existing demo IDs remain unchanged.                                                                                                       |

Incremental order: schema/permissions → verified identity and lightweight Club creation → memberships/invitations and Club Sessions → provider abstraction/onboarding/checkout → refunds, webhook synchronisation and payout security → tests and operational setup.

The canonical entities now live in `db/migrations/001_payment_onboarding.sql`, and all mutations use the existing Vercel API surface through `api/platform/[action].js`. There is no second Club or payment store. Browser local storage is used only by the pre-existing explicitly device-local draft feature and Supabase's managed auth session.

## Required database migration

1. Create a **Supabase PostgreSQL** project for this Jimmy repository (or confirm an existing compatible database).
2. Set `DATABASE_URL` to a TLS-enabled database/pooler connection usable by Vercel. Use the provider's CA/TLS instructions; do not disable certificate verification. Keep it server-only.
3. Run `npm run db:migrate` from this repository with that variable configured. The runner records checksums, serialises migration execution, and uses a transaction per migration.
4. The first migration is additive and creates users, Clubs, memberships, invitations, Sessions, payment accounts, payout destinations, bookings/transactions, refunds/disputes/payouts, audit/webhook events, single-use step-up tokens, security holds, email outbox, rate limits and risk flags. RLS is enabled with **no browser-access policies**. The server connection must be permitted to access these tables; never expose its credentials to the browser.
5. There is no production data reset or destructive import. If your selected database already contains conflicting table names, stop and map that schema before applying this initial migration. Do not use this migration against the unrelated parent project's schema without a separate migration review.

Database constraints enforce one active account/destination per Club, one active Owner, unique membership, unique active bookings, unique provider events, and consistent Club ownership across Sessions, bookings and transactions. Membership removal is soft deletion; financial and historical records remain.

## Environment variables and manual configuration

Copy `.env.example` and add the corresponding values to Vercel. Browser `VITE_*` variables require a rebuild.

| Variable                                      | Purpose                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public Supabase project URL and public anon key; never use the service-role key here.                                            |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`           | Server-side token validation and password step-up against the same project.                                                      |
| `DATABASE_URL`                                | Server-only Postgres/pooler URL.                                                                                                 |
| `APP_ORIGIN`                                  | Exact HTTPS origin, currently `https://jimmy-xi-snowy.vercel.app`, without trailing slash. Used for redirects and origin checks. |
| `STRIPE_SECRET_KEY`                           | Start with Stripe test mode. Enable Connect for GB Custom connected accounts supporting card payments and transfers.             |
| `STRIPE_WEBHOOK_SECRET`                       | Signing secret for the **connected-account** webhook endpoint `/api/stripe-webhook`.                                             |
| `PLATFORM_FEE_BPS`                            | Fee deducted from the Session price; default 500 (5%). No extra player service fee is added.                                     |
| `PAYOUT_CHANGE_HOLD_HOURS`                    | Default 48, minimum 24 hours. Provider automatic payouts pause during protected changes.                                         |
| `NEW_CLUB_REVIEW_GMV_PENCE`                   | New-Club review threshold; default 500000 (£5,000).                                                                              |
| `RESEND_API_KEY`, `EMAIL_FROM`                | Verified email sender for Club invitations and finance/security notices.                                                         |
| `CRON_SECRET`                                 | Long random bearer secret protecting `/api/platform/jobs`.                                                                       |

### Supabase authentication

Enable email/password sign-up, email confirmation, and **Allow unverified email sign in**, where available. The last option is necessary to meet the specification's unverified-login requirement without falsely confirming an email. Do **not** disable verification or auto-confirm users as a workaround. If your Supabase deployment does not support this option, unverified users cannot log in until verified; this acceptance criterion remains blocked by provider configuration/version and requires a supported auth deployment.

Configure custom SMTP, the actual site origin and allowed redirects `/?verified=1` and `/?reset=1`. Require passwords of at least 12 characters. Configure Supabase Auth's rate limits for password/token, signup, recovery and resend endpoints, and email link expiry (e.g. 1 hour). Verification/reset links are provider-managed and invalidated by the provider. Enable secure email changes. No phone or SMS registration is used. The API validates the access token via Supabase `getUser` on every authenticated request and refreshes the authoritative email confirmation timestamp; it never trusts a browser's verified flag.

Supabase owns password hashing, token refresh and verification/reset token security. Confirm email delivery and unverified-login behavior in staging before launch.

### Stripe Connect

This implementation uses **Custom accounts with Stripe-hosted onboarding** and **direct charges**. This gives Jimmi an Owner-gated `account_update` flow while Stripe collects legal and bank information. It intentionally does not issue Express Dashboard login links that would bypass the protected bank-change flow. Custom account operation requires Stripe platform approval and ongoing platform obligations; confirm this configuration with your Stripe account before going live.

Individual and company entries set `business_type`; organisation entries preserve Jimmi metadata and let Stripe's hosted flow select the supported legal structure. An informal group is not automatically treated as incorporated. Stripe is authoritative for legal/KYC state; no passports, DOB, UBO documents or bank account numbers are collected or stored by Jimmi.

All direct charges and refunds use the connected account stored on the Club transaction. Price, currency, platform fee, Club and account routing are resolved server-side. Checkout success redirects never mark a booking paid. Checkout/refund intents are committed before network calls and use stable PSP idempotency keys.

Configure the webhook to receive:

- `account.updated`, `account.external_account.created`, `.updated`, `.deleted`;
- `payment_intent.succeeded`, `.payment_failed`, `.canceled` (other PaymentIntent events may also be delivered);
- `checkout.session.expired`;
- `refund.created`, `.updated`, `.failed`;
- `charge.dispute.created`, `.updated`, `.closed`;
- `payout.created`, `.updated`, `.paid`, `.failed`, `.canceled`.

Webhook signatures use the untouched raw request body. Provider event IDs and mutations commit atomically; failed processing rolls back for retry. Mutable financial/account objects are re-read from Stripe so out-of-order event payloads do not simply overwrite newer provider state. Configure Stripe retrying and monitor non-2xx delivery errors. Refunds/disputes retain original Club/Session/booking linkage, including after an Organizer leaves.

### Email, jobs and payout changes

Verify the Resend sending domain. Invitations are queued durably, sent immediately when possible and retried by the scheduled job. Accepted invitations cannot be replayed; tokens are hashed and expire after 7 days. Delivered outbox bodies are cleared to avoid retaining invitation URLs.

`vercel.json` includes a daily job (03:00 UTC). Configure `CRON_SECRET`. For timely retry/reconciliation and shorter hold-release latency, use a plan-supported more frequent schedule, or your existing scheduler with `Authorization: Bearer <CRON_SECRET>`. Do not invoke this endpoint without authentication. Holds may end later than their minimum duration depending on the schedule. The job also reconciles payments that succeed after their Session was cancelled and retries their full refunds. Check Club Finance for unresolved failures.

Only Owner can request an update, after password re-entry and a five-minute, single-use Club-bound token. The provider is switched to a manual schedule **as a temporary security hold**; the application exposes no manual withdrawal/wallet. The update is hosted by Stripe. A new destination must be validated/verified by Stripe, the hold elapsed and risk review cleared before the scheduled job restores daily automatic payouts. Notifications go to Owner/Admin and audit records capture request/completion. Unexpected provider-side bank changes pause payouts and create a review flag. Only masked bank name/last4 and provider references are stored. A fingerprint is hashed for cross-Club reuse review.

Risk flags are visible to Owner/Admin. Platform staff must investigate flags using the database/support process; Club users cannot clear their own flags. After a documented review, authorised platform staff can change `risk_flags.status` from `review` to `cleared` and record an audit event. No automatic Club deletion is performed.

## Scope and remaining limitations

- **Not live-tested:** SMTP delivery, email verification/reset, actual Stripe hosted KYC, test-card checkout, signed Stripe CLI webhooks, real refunds and payout changes need configured services. Automated provider tests use fakes and the migration is tested on PGlite; this is not proof of a live payment integration.
- Coach certification review/upload remains the pre-existing explicitly unconfigured feature; this specification does not supply that backend.
- Existing Session photo upload, insurance, early-bird/women discounts and pay-at-venue options were mock UI. Unsupported upload/discount/payment options now block saving explicitly instead of silently losing data or charging an incorrect amount.
- Operational Session description edits and attendance are supported after publication. Time/price/capacity changes after publication require cancellation/refund and a replacement Session, avoiding silent changes to booked players.
- Connected-account Club closure remains support-gated until balances, outstanding bookings, refunds and disputes are reconciled. Clubs without payment accounts can be archived after published Sessions finish or are cancelled.
- Partial refunds are not exposed (full refunds are V1); refund records preserve explicit amounts for a later partial-refund extension.
- Advanced anomaly detection/access telemetry and a dedicated platform-staff risk-review interface are not included. Current controls flag rapid Club creation, rapid new-Club GMV, high refund/dispute rates, repeated payout changes and shared bank fingerprints.
- No legacy demo financial history is represented as a real ledger or verification result. Demo Sessions cannot accept real bookings. Public trust labels do not imply KYC verification.

## Validation

Current validation: **26 automated tests pass** and the Vite production build passes. No production migration or live-service verification has been performed.

`npm test` runs rendered form checks and migration-backed domain/service tests for email-verification gates, invitations, multi-Club roles, assigned Organizer access, free/paid publication, separate Club accounts, database uniqueness, payout step-up/notifications/audit, direct-charge routing, duplicate webhooks, linked refunds and retained revenue after member removal. `npm run build` validates the existing Vite production app. See test files for precise mocked-provider boundaries.

## Primary provider references

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase authentication configuration](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/general-configuration.mdx)
- [Stripe-hosted Connect onboarding](https://docs.stripe.com/connect/hosted-onboarding)
- [Stripe direct charges](https://docs.stripe.com/connect/direct-charges)
- [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks)
