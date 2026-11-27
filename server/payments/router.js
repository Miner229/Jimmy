// HTTP routing for /api/payments/* (one Vercel function, Web-standard Request/Response).
// vercel.json rewrites /api/payments/<route> to /api/payments?route=<route>.

import { timingSafeEqual } from 'node:crypto';
import { ConfigError, loadConfig } from './config.js';
import { createStripeClient, StripeApiError } from './stripe-client.js';
import { createAuthVerifier, createDatabase, DatabaseError } from './supabase.js';
import { createPaymentsService, PaymentError } from './service.js';

let cached;
export function buildDependencies(env = process.env) {
  if (cached) return cached;
  const config = loadConfig(env);
  const stripe = createStripeClient({ secretKey: config.stripeSecretKey });
  const db = createDatabase({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey });
  const getUser = createAuthVerifier({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey });
  const service = createPaymentsService({ config, stripe, db });
  cached = { config, service, getUser };
  return cached;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export function errorResponse(error) {
  if (error instanceof PaymentError) return json(error.status, { error: error.message, code: error.code });
  if (error instanceof ConfigError) {
    console.error(JSON.stringify({ scope: 'payments', level: 'error', message: 'config_error', detail: error.message }));
    return json(503, { error: 'Payments are not configured on this server.', code: 'payments_not_configured' });
  }
  if (error instanceof StripeApiError || error instanceof DatabaseError) {
    console.error(JSON.stringify({ scope: 'payments', level: 'error', message: error.name, code: error.code, status: error.status }));
    return json(502, { error: 'A payment service is temporarily unavailable. Please try again.', code: 'upstream_error' });
  }
  console.error(JSON.stringify({ scope: 'payments', level: 'error', message: 'unexpected_error', name: error?.name }));
  return json(500, { error: 'Something went wrong.', code: 'internal_error' });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 20000) throw new PaymentError(413, 'payload_too_large', 'Request is too large.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PaymentError(400, 'invalid_json', 'Invalid request body.');
  }
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handlePaymentsRequest(request, deps) {
  try {
    const { config, service, getUser } = deps || buildDependencies();
    const url = new URL(request.url);
    const route = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/payments\/?/, '')).replace(/\/+$/, '');
    const method = request.method.toUpperCase();

    // Scheduled job (Vercel Cron sends Authorization: Bearer <CRON_SECRET>)
    if (route === 'jobs/reconcile') {
      if (!config.cronSecret || !safeEqual(bearer(request), config.cronSecret)) {
        return json(401, { error: 'Unauthorized', code: 'unauthorized' });
      }
      return json(200, await service.reconcile());
    }

    if (route === 'sessions' && method === 'GET') return json(200, { sessions: await service.listSessions() });

    const user = await getUser(bearer(request));
    if (!user) return json(401, { error: 'Please sign in.', code: 'unauthenticated' });

    const routes = {
      'POST host/onboard': async () => service.onboardHost(user, await readJson(request)),
      'GET host/overview': async () => ({ hosts: await service.hostOverview(user) }),
      'GET host/status': async () => service.hostStatus(user, url.searchParams.get('host_id')),
      'POST sessions': async () => service.createSession(user, await readJson(request)),
      'POST sessions/cancel': async () => service.cancelSession(user, await readJson(request)),
      'POST checkout': async () => service.startCheckout(user, await readJson(request)),
      'GET checkout/return': async () => service.checkoutReturn(user, url.searchParams.get('session_id')),
      'GET bookings': async () => ({ bookings: await service.myBookings(user) }),
      'POST bookings/cancel': async () => service.cancelBooking(user, await readJson(request)),
    };
    const handler = routes[`${method} ${route}`];
    if (!handler) return json(404, { error: 'Not found', code: 'not_found' });
    return json(200, await handler());
  } catch (error) {
    return errorResponse(error);
  }
}
