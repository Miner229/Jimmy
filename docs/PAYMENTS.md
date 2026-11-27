# JimmiPlay Payments v1 — Stripe Connect Direct Charges

Status: **test mode only, not deployed.** Branch `payment/integration`, draft PR into `main`.
Last updated: 27 Nov 2026.

## 1. Decisions this build follows

| Topic | Decision | Source |
| --- | --- | --- |
| Charge type | Direct Charges: Checkout Session created on the host's connected account | Owner, Option 1 |
| Platform fee | 1% (`PLATFORM_FEE_BPS=100`), integer half-up to the penny; players pay the listed price | 6 Nov handover, owner |
| Accounts API | Accounts v1, `controller.stripe_dashboard.type = "full"`; `fees.payer`, `losses.payments`, `requirement_collection` left at defaults (`account`, `stripe`, `stripe`) | Owner, 23 Nov |
| API version | `Stripe-Version: 2026-11-18.endive` on every request (`server/payments/config.js`) | docs.stripe.com/upgrades |
| Hosts | A host is a club or an individual organiser, with one owner user; one Stripe account per host; any signed-in user can book | Owner, 23 Nov |
| Refunds | Full refunds of the remaining amount, `refund_application_fee=true` | Brief, handover |
| Environment | Stripe test mode and the Supabase test project `jimmiplay-payments-test` only | Owner |

There is no Stripe or Postgres SDK dependency. Package installs were unavailable while this was built, so Stripe and Supabase are called over their documented HTTPS APIs (`server/payments/stripe-client.js`, `server/payments/supabase.js`). Switching to the `stripe` npm SDK later is a contained change. The SDK request option `stripeAccount` maps to the `Stripe-Account` header used here.

## 2. Architecture and API flow

```
Browser (src/payments/*)            Vercel functions                       Stripe (host account)
  Supabase Auth (email+password) ─▶ /api/payments/*  (server/payments/router.js)
                                      │  verifies user token: GET /auth/v1/user
                                      ├─ payments service (server/payments/service.js) ──▶ /v1/accounts, /v1/account_links
                                      │                                                    /v1/checkout/sessions  (Stripe-Account)
                                      │                                                    /v1/refunds           (Stripe-Account)
                                      └─ Postgres functions payments_* (db/migrations/0002..0004) via /rest/v1/rpc
  Stripe ──────────────────────────▶ /api/stripe/connect-webhook (signature check on raw body) ──▶ same service
  Vercel Cron (daily) ─────────────▶ /api/payments/jobs/reconcile
```

**Where the rules live:** seat allocation, fulfilment, refunds and event de-duplication are Postgres functions that each run in one transaction. They lock the `sessions` row for seats and the `payments` row for money. The API can only call them with the server-only Supabase secret key, and EXECUTE is revoked from `anon` and `authenticated`.

### Onboarding and account context
1. `POST /api/payments/host/onboard` `{display_name, host_type: club|individual, payment_entity_type: individual|company|organisation}`. This creates `hosts` (`payments_create_host`), then `POST /v1/accounts` with `controller[stripe_dashboard][type]=full`, `country=GB`, `email`, `business_profile[product_description]` and `metadata[jimmiplay_host_id]`, using idempotency key `account-create-<host_id>`. It then attaches the account (`payments_attach_account`, which never replaces a different account) and returns a fresh `POST /v1/account_links` with `type=account_onboarding`, `collection_options[fields]=eventually_due`, `refresh_url`, `return_url`.
2. `refresh_url` → `/dev53/payments?tab=host&onboarding=refresh&host=<id>`. The page calls onboard again with `host_id` and redirects to a new link. This covers expired or reused links.
3. `return_url` → `…&onboarding=return…`. The page calls `GET /api/payments/host/status`, which retrieves `GET /v1/accounts/{id}` and stores `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements.*` and `capabilities` (`payments_sync_host`). It also reads `GET /v1/balance` with `Stripe-Account` and shows available and pending GBP.
4. Paid sessions can be published only when `charges_enabled` is true and the host is not deauthorized. `payments_create_session` and `payments_reserve_seat` both check this.
5. Capabilities are **not** requested. Stripe's docs require capability requests only for accounts *without* the full Dashboard; full-Dashboard hosts manage payment methods themselves.

The payment state shown to hosts (spec §16) is derived only from Stripe data: `NOT_STARTED → ONBOARDING → REQUIREMENTS_PENDING / ADDITIONAL_VERIFICATION_REQUIRED → VERIFIED → PAYOUTS_PAUSED / PAYOUTS_ENABLED`, plus `RESTRICTED` and `DISABLED` (`derivePaymentState` in `server/payments/service.js`).

### Payment, fee and booking confirmation
1. `POST /api/payments/checkout {session_id}` → `payments_reserve_seat`. It locks the session row, checks status, start time, host capability and capacity (`reserved` + `confirmed`), and computes the fee with `payments_fee_minor` (`(amount×bps + 5000) / 10000`). It inserts `bookings(status=reserved)` and `payments(status=pending, checkout_expires_at=now+31 min)`. If the player already has an open Checkout Session, its URL is returned instead of creating a second one.
2. `POST /v1/checkout/sessions` with `Stripe-Account: <host acct>` and `Idempotency-Key: checkout-<payment_id>-<expires_at>`. Parameters: `mode=payment`, `line_items[0][price_data]` (GBP, `unit_amount` from the DB, never from the browser), `payment_intent_data[application_fee_amount]`, `payment_intent_data[metadata]`, `client_reference_id=<booking_id>`, `metadata[jimmiplay_booking_id]`, `customer_email`, `expires_at`, `success_url=…?tab=bookings&checkout=success&session_id={CHECKOUT_SESSION_ID}`, `cancel_url`. No `payment_method_types` is sent, so cards and eligible Apple Pay and Google Pay come from the host's Dashboard settings.
3. A booking is confirmed only from Stripe evidence. Both `checkout.session.completed` / `checkout.session.async_payment_succeeded` (webhook) and the return page (`GET /api/payments/checkout/return`) re-read the Checkout Session with `Stripe-Account` and call the same idempotent `payments_fulfil`. That function checks the account, `livemode`, amount and currency against the stored payment before anything changes. `payment_status=unpaid` → `processing`, and the seat stays held. `paid` → `confirmed`.
4. **Late payments:** if the booking had already expired, `payments_fulfil` confirms it only if a seat is still free; otherwise the booking becomes `late_paid` and a full refund starts. An existing valid booking is never displaced.
5. **Duplicate checkout:** a second paid Checkout Session for the same booking is refunded in full (`refund_application_fee=true`, idempotency key `duplicate-<cs id>`).
6. **Expiry:** `checkout.session.expired` (or the reconcile job, which calls `POST /v1/checkout/sessions/{id}/expire` for overdue open sessions) releases the seat through `payments_release`.

**Stored for every payment:** `stripe_account_id`, `livemode`, `checkout_session_id`, `payment_intent_id`, `booking_id`, `amount_minor`, `application_fee_minor`. All later retrievals and refunds use the stored account.

### Refunds
- Player cancellation before `starts_at − refund_deadline_hours` (`POST /api/payments/bookings/cancel`), host session cancellation (`POST /api/payments/sessions/cancel`) and late payments all go through `payments_request_refund`. That function inserts a `refunds` row (`requested`) first, so its id becomes the idempotency key, and the booking becomes `refund_pending`, which frees the seat.
- **Check before re-issuing:** before creating a refund, the server lists `GET /v1/refunds?payment_intent=…` on the host account and looks for `metadata.jimmiplay_refund_id`. If a refund is found, it is recorded instead of created again. Otherwise the server calls `POST /v1/refunds` with `payment_intent`, `amount`, `refund_application_fee=true` and `metadata[jimmiplay_refund_id]`, using key `refund-<id>`.
- States `requested → pending / requires_action → succeeded / failed / canceled` come from the API response, `refund.updated`, `refund.failed`, `charge.refunded` and the reconcile job. A final state never moves back to an earlier one. When refunds reach the payment amount, the booking becomes `cancelled_refunded` (or `late_paid_refunded`).
- **Refunds hosts make in their own Stripe Dashboard** arrive through `charge.refunded` without `jimmiplay_refund_id`. They are recorded with `origin=stripe_dashboard`. JimmiPlay's fee is **not** returned for these unless the host chose that in Stripe (decision R2 below).
- **Fee on partial amounts:** Stripe returns the application fee in proportion to the amount refunded when `refund_application_fee=true`. JimmiPlay itself only issues full refunds of the remaining amount in v1.
- Refunds are blocked while a dispute is open.

### Disputes
`charge.dispute.*` → `payments_record_dispute` stores status, reason, amount and `evidence_details.due_by`, and the host overview shows open disputes. With full-Dashboard accounts on direct charges, the disputed amount and the dispute fee are debited from the **host's** Stripe balance, and the **host responds in their Stripe Dashboard** by the deadline. JimmiPlay's application fee is not returned automatically on a dispute. Negative-balance liability sits with Stripe for these accounts (`losses.payments=stripe`). Confirm that in the Dashboard before production.

### Host balances and payouts
- Stripe `pending` = not yet available; `available` = can be paid out. Shown per host from `GET /v1/balance`. Booking-level accounting (gross, JimmiPlay fee, refunded, disputes per session) comes from JimmiPlay's tables, in `payments_host_overview`.
- Host proceeds = price − Stripe processing fee (charged to the host account on direct charges) − JimmiPlay 1% fee − refunds and dispute debits.
- **Payout after each session is not possible with this configuration.** Stripe lets the platform set payout schedules only where it carries losses or has platform controls. Full-Dashboard hosts control their own schedule, and one Stripe balance mixes all sessions. JimmiPlay records `payout.*` events in `audit_log` and shows the schedule; it does not create payouts. See decision R1.

## 3. Event table (one Connect endpoint, "events on connected accounts")

All events go through `payments_begin_event` / `payments_finish_event`. The `stripe_events.event_id` primary key ignores duplicates, a handler error leaves the event unprocessed and returns HTTP 500 so Stripe retries, and the reconcile job re-fetches unprocessed events with `GET /v1/events/{id}`. Events without `account` (platform events) and events whose `livemode` differs from the key are acknowledged and ignored.

| Event | Account scope | Handler (re-reads from Stripe) | State transition | Extra duplicate protection |
| --- | --- | --- | --- | --- |
| `account.updated`, `capability.updated` | Connected | `GET /v1/accounts/{account}` → `payments_sync_host` | host charges/payouts/requirements/capabilities | Idempotent overwrite from Stripe state |
| `account.application.deauthorized` | Connected | `payments_host_deauthorized` | host disabled; no new paid bookings | `coalesce(deauthorized_at)` |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | Connected | `GET /v1/checkout/sessions/{id}` → `payments_fulfil` | payment `succeeded`; booking `reserved/expired → confirmed`, or `late_paid` → refund | Payment row lock; status checks; unique `checkout_session_id`, `payment_intent_id` |
| `checkout.session.async_payment_failed` | Connected | `payments_release(reason=async_payment_failed)` | payment `failed`; booking `expired` | Only from `pending/open/processing` |
| `checkout.session.expired` | Connected | re-read → `payments_release` | payment `expired`; booking `reserved → expired` | Never touches `succeeded` |
| `charge.refunded`, `charge.refund.updated` | Connected | `GET /v1/refunds?charge=…` → `payments_record_refund` each | refunds upserted (Dashboard refunds `origin=stripe_dashboard`); booking `cancelled_refunded` when fully refunded | Unique `stripe_refund_id`; no regression from final states |
| `refund.created`, `refund.updated`, `refund.failed` | Connected | `GET /v1/refunds/{id}` → `payments_record_refund` | refund status and failure reason | Same as above |
| `charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated` | Connected | `GET /v1/disputes/{id}` → `payments_record_dispute` | dispute status, amount, `evidence_due_by`; refunds blocked while open | `stripe_dispute_id` primary key (upsert) |
| `payout.paid/failed/canceled/…` | Connected | `payments_audit` | recorded for support; host sees schedule and status in Stripe | `stripe_events` primary key |

## 4. Configuration (names only, no values)

Environment variables (see `.env.example`):

| Name | Where | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | server | `sk_test_…`; live keys are refused unless `PAYMENTS_ALLOW_LIVE=true` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | server | signing secret of the Connect webhook endpoint (`whsec_…`) |
| `PLATFORM_FEE_BPS` | server | `100` = 1% |
| `APP_ORIGIN` | server | origin used in Stripe return/refresh/success/cancel URLs |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | server | database functions and token verification |
| `CRON_SECRET` | server | protects `/api/payments/jobs/reconcile` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | sign-in (public values) |

Dashboard and Sandbox steps:
1. **Stripe (test mode), Connect:** complete the platform profile for the UK and allow accounts with the full Stripe Dashboard. The test platform `acct_1UQ3AlFjb3nqBBMJ` currently shows its own requirements as `past_due`, which may block creating connected accounts until done.
2. **Stripe webhook:** Developers → Webhooks → Add endpoint. URL `https://<preview-host>/api/stripe/connect-webhook`, **Listen to events on Connected accounts**, with the events in section 3. Copy the signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. Locally, use `stripe listen --forward-connect-to localhost:3000/api/stripe/connect-webhook` and `stripe listen --print-secret`.
3. **Supabase test project** `jimmiplay-payments-test` (`wcpfpawaudldyorinvli`, eu-west-2): migrations `0001`–`0004` are applied (`0004` on 27 Nov 2026, self-tested: full name copied to `profiles.display_name`, `payment_entity_type` stored and validated, old function signature removed, `anon` has no EXECUTE). Under Authentication → URL Configuration, set Site URL `http://localhost:3000` and add the redirect URLs `http://localhost:3000/dev53/payments*` and `https://jimmy-git-payment-integration-me-2f53.vercel.app/dev53/payments*` (Vercel preview of this branch). Email confirmation stays on (spec §2). The built-in mailer is rate-limited, so add SMTP before wider testing.
4. **Vercel:** set the variables for **Preview / Development with test values only**. Leave Production unset until approval. The cron in `vercel.json` runs daily (`17 3 * * *`), which is the Hobby plan limit; a more frequent reconcile needs Pro or an external scheduler.
5. **Local run:** `npm install`, then `powershell -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1` on Windows (or copy `.env.example` to `.env.local`), then `npx vercel dev`, and open `http://localhost:3000/dev53/payments`.

## 5. Verification (27 Nov 2026)

| What | How | Result | Type |
| --- | --- | --- | --- |
| Server unit tests | `node --test tests/*.test.mjs` (Node 22.23) | 36/36 pass across 5 files (24 payments + 12 existing); `tests/creation.test.mjs` needs `esbuild` from `npm install` and fails on `main` too | Local, mocked Stripe/Supabase |
| Database rules | SQL self-test against the Supabase **test** project in a rolled-back transaction (Supabase connector `execute_sql`) | All pass: fee 1000→10p, 750→8p, 749→7p; last-seat race (`session_full`); reuse of open checkout; `account_mismatch`, `livemode_mismatch`, `amount_mismatch`; `unpaid→processing`; expiry ignored while processing and after payment; duplicate fulfil → `already_confirmed`; second checkout → `duplicate_payment`; refund by non-owner refused; refund retry returns same row; seat freed on cancel; late `pending` after `succeeded` ignored; late payment → `refund_required`, other player's booking stays `confirmed`, then `late_paid_refunded`; partial/full Dashboard refunds; refund blocked by open dispute; event `new/retry/done`; `anon`/`authenticated` cannot execute functions. No rows left afterwards | Supabase test DB |
| Supabase security advisor | `get_advisors(security)` | Only `rls_enabled_no_policy` (INFO), intended for server-only tables | Supabase test DB |
| Stripe Sandbox state | Stripe connector, read-only, platform `acct_1UQ3AlFjb3nqBBMJ`, `livemode=false` | GB, GBP; 0 connected accounts, 0 charges, 0 refunds, 0 application fees, 0 webhook endpoints. **The failed £10 test refund from the 6 Nov handover does not exist in this account**, and there are no historical payments to migrate | Stripe Sandbox (read) |
| Front-end syntax and names | TypeScript 6.0.2 parser and checkJs on `src/payments/*`, `src/App.jsx` | No syntax errors; no undefined names | Local |
| End-to-end Sandbox payments | — | **Pending.** It needs a `sk_test_` key on a machine with network access. The Stripe connector cannot create connected accounts or act on them | Pending |
| `vite build` | — | **Pending** (packages not installable here) | Pending |

### Acceptance checklist status

| Scenario | Status |
| --- | --- |
| Individual and company onboarding; state shown in JimmiPlay | Implemented; Sandbox run pending |
| Expired onboarding link | Implemented (`refresh_url` → new link); pending |
| Payment on the correct host account, amount and currency match | Implemented and DB-tested (mismatch refused); Sandbox pending |
| 1% fee rounding; player pays listed price | Implemented; unit and DB tested |
| Card and wallets | Checkout dynamic payment methods; device test pending |
| Return from Checkout | Implemented (server re-read + fulfil); pending |
| Webhook repeat → one record, one seat | DB-tested |
| Out-of-order events | Re-read from Stripe + no regression from final states; DB-tested |
| Two players, last seat | DB-tested (session row lock) |
| Late payment for expired booking | DB-tested; refund path unit-tested |
| Full refund with fee returned | Implemented (`refund_application_fee=true`); Sandbox pending |
| Partial refund | Not offered by JimmiPlay in v1 (decision R3); Dashboard partial refunds recorded |
| Insufficient balance for refund | States tracked; reconcile re-reads; Sandbox pending |
| Existing failed £10 refund | Not present in the connected Stripe test account (see above) |
| Bank account change | Handled by Stripe for full-Dashboard hosts; JimmiPlay cannot enforce spec §15 (decision R1) |
| Payout failure | Recorded; host sees status in Stripe; Sandbox pending |
| Capability loss | `account.updated` / `capability.updated` → sync; paid publishing and checkout blocked |
| Dispute | Recorded with deadline; host responds in Stripe |
| Scheduled jobs | Daily Vercel cron with bearer secret; start and finish written to `audit_log`; alerting pending (R5) |
| Historical payments | None exist in DB or Stripe test account |
| Mobile UI | Responsive layout; device test pending |

## 6. Operations checklist

- **Checkout fails to start:** see `payments.last_error` for the payment and the Vercel log line `checkout.create_failed`. The seat stays reserved until `checkout_expires_at`, then the reconcile job releases it.
- **Webhook failing:** look in `stripe_events` for `processed_at is null`, plus `last_error` and `attempts`. Stripe retries for up to three days, and the reconcile job re-fetches the event. Fix the cause; never mark it processed by hand.
- **Refund stuck in `requested` or `pending`:** reconcile re-reads Stripe first and re-issues only if no refund carries `metadata.jimmiplay_refund_id`. For `failed`, read `failure_reason` and the host's balance in Stripe, then let the player cancel again or refund in the host Dashboard. That refund will be recorded.
- **Booking stuck in `refund_pending`:** check the refunds for that payment. Possible causes are an open dispute, a failed refund, or Stripe still pending.
- **Dispute opened:** the host must respond in the Stripe Dashboard before `disputes.evidence_due_by`. Keep the booking history from `audit_log`.
- **Host shows "Payments not enabled":** open Host → Refresh status, which re-reads Stripe. The `requirements` list shows what Stripe needs. The host continues through "Continue Stripe setup".
- **Payout failed:** this is recorded in `audit_log` (`payout.failed`). The host fixes the bank account in Stripe; JimmiPlay does not retry payouts.
- **Reconcile job:** `GET /api/payments/jobs/reconcile` with `Authorization: Bearer $CRON_SECRET`. It returns counts and errors. Look for `job.reconcile.finished` in `audit_log` within the last 25 hours to detect a stalled job.
- **Logs** contain IDs and codes only: no emails, names, card data or keys.

## 7. Remaining decisions and gaps

| # | Decision or gap | Impact |
| --- | --- | --- |
| R1 | **Payout after session / payout-account security (spec §14–15).** With full-Dashboard hosts, Stripe and the host control payout schedule and bank changes. | "Pay after the session", JimmiPlay holds on bank changes, and dual approval cannot be enforced. Reaching them needs a platform-controlled configuration (Express or no Dashboard with `losses.payments=application`), where JimmiPlay then carries losses and disputes. |
| R2 | Should JimmiPlay return its 1% when a host refunds from their own Dashboard? | Currently not returned; recorded as `origin=stripe_dashboard`. |
| R3 | Partial refund policy | Not offered by JimmiPlay in v1; the architecture supports it (refund amount, proportional fee). |
| R4 | Keep the application fee on disputes? | Currently kept; no automatic return. |
| R5 | Failure notifications | Logs plus `audit_log` only. An email or alerting provider is needed for job, refund and payout failure alerts. |
| R6 | Club roles, invitations and multi-organiser model (spec §5–7) | v1 has one owner per host (owner's choice on 23 Nov). Club memberships (Owner/Admin/Organizer), invites and role-based refunds are not built. |
| R7 | Registration extras (spec §2.3) | Supabase Auth handles hashing, email verification and rate limits. A password-reset UI and "resend verification" are not built yet. |
| R8 | Risk layer (spec §20) | Not built. Stripe's own risk checks apply. |
| R9 | Free sessions | Not handled by the payments flow (`free_sessions_not_supported`). |
| R10 | Production | Live keys are blocked in code. A deployment, live webhook and live Stripe Connect profile need explicit approval. |
