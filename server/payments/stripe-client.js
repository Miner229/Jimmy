// Minimal Stripe API client over HTTPS (no SDK dependency).
// - Pins the API version with the Stripe-Version header.
// - Runs requests on a connected account with the Stripe-Account header
//   (https://docs.stripe.com/connect/authentication).
// - Sends an Idempotency-Key on every POST and retries only those requests
//   (https://docs.stripe.com/api/idempotent_requests).

import { randomUUID } from 'node:crypto';
import { STRIPE_API_VERSION } from './config.js';

const API_BASE = 'https://api.stripe.com';

export class StripeApiError extends Error {
  constructor({ status, type, code, message, param, requestId }) {
    super(message || `Stripe API error (${status})`);
    this.name = 'StripeApiError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
    this.requestId = requestId;
  }
}

// application/x-www-form-urlencoded with Stripe's nested bracket syntax:
// { a: { b: 1 }, list: [{ c: 2 }] } -> a[b]=1&list[0][c]=2
export function encodeForm(params) {
  const pairs = [];
  const add = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params || {})) add(key, value);
  return pairs.join('&');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createStripeClient({ secretKey, fetchImpl = globalThis.fetch, maxRetries = 2, timeoutMs = 15000 }) {
  if (!secretKey) throw new Error('Stripe secret key is required');

  async function request(method, path, { params, stripeAccount, idempotencyKey } = {}) {
    const upper = method.toUpperCase();
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
    };
    if (stripeAccount) headers['Stripe-Account'] = stripeAccount;

    let url = `${API_BASE}${path}`;
    let body;
    if (upper === 'GET' || upper === 'DELETE') {
      const query = encodeForm(params);
      if (query) url += `?${query}`;
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Idempotency-Key'] = idempotencyKey || randomUUID();
      body = encodeForm(params);
    }

    const retryable = upper === 'GET' || Boolean(headers['Idempotency-Key']);
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, { method: upper, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (networkError) {
        if (retryable && attempt < maxRetries) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new StripeApiError({ status: 0, type: 'network_error', message: 'Could not reach Stripe' });
      }

      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (response.ok) return json;

      const shouldRetry = retryable && attempt < maxRetries &&
        (response.status === 429 || response.status >= 500 || response.headers?.get?.('stripe-should-retry') === 'true');
      if (shouldRetry) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      const err = json.error || {};
      throw new StripeApiError({
        status: response.status,
        type: err.type,
        code: err.code,
        message: err.message,
        param: err.param,
        requestId: response.headers?.get?.('request-id') || undefined,
      });
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
  };
}
