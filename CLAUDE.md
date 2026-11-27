# JimmiPlay

Badminton booking site: React 18 + Vite front end (`src/`, served under `/dev53`), Vercel functions (`api/`), Supabase (Postgres + Auth), and Stripe Connect payments.

## Payments rules
- Payment work happens on the `payment/integration` branch and reaches `main` only through a reviewed pull request. Never push to `main`.
- Stripe **test mode only** (`sk_test_…`). Live keys are blocked in code (`PAYMENTS_ALLOW_LIVE`). Production deployment, live webhooks or live Stripe/Supabase changes need the owner's explicit approval.
- Supabase test project: `jimmiplay-payments-test` (ref `wcpfpawaudldyorinvli`, eu-west-2). Schema changes go in a new file in `db/migrations/`; never edit an applied migration.
- Secrets live in `.env.local` or Vercel environment variables only. Never commit, print or log them, and never ask for them in chat.
- Changes are additive to the live site. Flag changes to booking, authentication, orders, refunds or database schemas in the PR description.
- Build from current Stripe documentation for the pinned API version (`server/payments/config.js`). Seat and money rules live in the `payments_*` Postgres functions.
- If you are not sure about something, ask the owner first.
- Code, docs, UI labels and tab names are in English.

## Where things are
- `docs/PAYMENTS.md`: architecture, event table, configuration, verification, operations, open decisions.
- `JIMMI_PAYMENT_ONBOARDING_SPEC.md`: product specification (club model, roles, onboarding).
- `server/payments/`: Stripe client, webhook signature check, Supabase access, payments service, HTTP router.
- `api/payments.js` (all `/api/payments/*` routes through a `vercel.json` rewrite) and `api/stripe/connect-webhook.js`.
- `src/payments/`: sign-in, API client, Payments page (`/dev53/payments`).

## Commands
- `npm install`, then `npm run dev` (front end only, http://localhost:5173).
- `npx vercel dev` (front end + API, http://localhost:3000).
- `stripe listen --forward-connect-to localhost:3000/api/stripe/connect-webhook` forwards Stripe test events.
- `npm test` runs all tests; `npm run test:payments` runs the payments tests only.
- Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1` creates `.env.local`.
