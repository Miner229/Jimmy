// Verifies the Stripe-Signature header against the raw request body, as described in
// https://docs.stripe.com/webhooks#verify-manually :
//   signed_payload = `${t}.${raw body}`; expected = HMAC-SHA256(endpoint secret, signed_payload)
//   compare with every v1 signature in constant time; reject timestamps outside the tolerance.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_TOLERANCE_SECONDS = 300;

export class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignatureError';
  }
}

export function parseSignatureHeader(header) {
  const result = { timestamp: null, signatures: [] };
  for (const part of String(header || '').split(',')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') result.timestamp = Number.parseInt(value, 10);
    if (key === 'v1') result.signatures.push(value);
  }
  return result;
}

export function computeSignature(payload, secret, timestamp) {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

export function verifyStripeSignature(payload, header, secret, {
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  if (!secret) throw new SignatureError('Webhook secret is not configured');
  if (typeof payload !== 'string') throw new SignatureError('Payload must be the raw request body string');
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new SignatureError('Unable to read the Stripe-Signature header');
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new SignatureError('Timestamp outside the tolerance zone');
  }
  const expected = Buffer.from(computeSignature(payload, secret, timestamp), 'hex');
  const matches = signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matches) throw new SignatureError('No signatures found matching the expected signature');
  return JSON.parse(payload);
}
