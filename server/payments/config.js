// Server-side configuration for payments. Values come from environment variables only;
// they are never logged or returned to the browser.

export const STRIPE_API_VERSION = '2026-11-18.endive';
export const APP_BASE_PATH = '/dev53';
// Checkout Sessions must expire 30 minutes to 24 hours after creation. One extra minute
// covers the time between reserving the seat and creating the session.
export const RESERVATION_HOLD_MINUTES = 31;
// Stripe's minimum charge amount for GBP is 30p.
export const MIN_PRICE_MINOR = 30;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env, name) {
  const value = env[name];
  if (!value || !String(value).trim()) throw new ConfigError(`Missing environment variable ${name}`);
  return String(value).trim();
}

export function loadConfig(env = process.env) {
  const stripeSecretKey = required(env, 'STRIPE_SECRET_KEY');
  const livemode = /^(sk|rk)_live_/.test(stripeSecretKey);
  if (!/^(sk|rk)_(test|live)_/.test(stripeSecretKey)) {
    throw new ConfigError('STRIPE_SECRET_KEY must be a Stripe secret or restricted key');
  }
  // Live keys stay blocked until production use is explicitly approved.
  if (livemode && env.PAYMENTS_ALLOW_LIVE !== 'true') {
    throw new ConfigError('Live Stripe keys are blocked. Use a test key (sk_test_...)');
  }

  const feeBps = Number.parseInt(env.PLATFORM_FEE_BPS ?? '100', 10);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000) {
    throw new ConfigError('PLATFORM_FEE_BPS must be an integer between 0 and 2000');
  }

  const appOrigin = required(env, 'APP_ORIGIN').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(appOrigin)) throw new ConfigError('APP_ORIGIN must start with http:// or https://');

  return {
    stripeSecretKey,
    livemode,
    webhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET ? String(env.STRIPE_CONNECT_WEBHOOK_SECRET).trim() : '',
    feeBps,
    appOrigin,
    supabaseUrl: required(env, 'SUPABASE_URL').replace(/\/+$/, ''),
    supabaseSecretKey: required(env, 'SUPABASE_SECRET_KEY'),
    // The publishable key is public; the browser's copy is accepted so it is set only once.
    supabasePublishableKey: required(
      { SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY },
      'SUPABASE_PUBLISHABLE_KEY',
    ),
    cronSecret: env.CRON_SECRET ? String(env.CRON_SECRET) : '',
  };
}

export function appUrl(config, query) {
  const search = new URLSearchParams(query).toString();
  return `${config.appOrigin}${APP_BASE_PATH}/payments${search ? `?${search}` : ''}`;
}
