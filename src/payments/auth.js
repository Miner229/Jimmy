// Supabase Auth over its REST API (email + password). The access token is sent to
// /api/payments as "Authorization: Bearer <token>"; the server verifies it with Supabase.
// Only the public (publishable) key is used in the browser.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const STORAGE_KEY = 'jimmiplay.auth';

export const authConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);

function load() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function save(session) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable: keep the session in memory only */ }
  current = session;
}

let current = typeof window !== 'undefined' ? load() : null;

function toSession(data) {
  if (!data?.access_token) return null;
  const expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    user: data.user ? { id: data.user.id, email: data.user.email } : current?.user || null,
  };
}

async function authFetch(path, body, token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.error_description || data.message || 'Sign-in failed. Please try again.');
  }
  return data;
}

export function currentUser() {
  return current?.user || null;
}

// After the confirmation email link, Supabase redirects back with tokens in the URL hash.
export function consumeRedirectSession() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  if (!params.get('access_token')) return null;
  const session = toSession({
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    expires_in: Number(params.get('expires_in') || 3600),
  });
  save(session);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return session;
}

export async function signIn(email, password) {
  const session = toSession(await authFetch('token?grant_type=password', { email, password }));
  save(session);
  return session;
}

// Returns a session when email confirmation is off; otherwise null (check your inbox).
export async function signUp(email, password, fullName) {
  const redirect = `${window.location.origin}${window.location.pathname}?tab=account`;
  const data = await authFetch(`signup?redirect_to=${encodeURIComponent(redirect)}`, {
    email, password, data: { full_name: fullName },
  });
  const session = toSession(data);
  if (session) save(session);
  return session;
}

export async function signOut() {
  const token = current?.access_token;
  save(null);
  if (token) await authFetch('logout', null, token).catch(() => {});
}

export async function getAccessToken() {
  if (!current) return null;
  if (current.expires_at - 60 > Math.floor(Date.now() / 1000)) return current.access_token;
  try {
    const refreshed = toSession(await authFetch('token?grant_type=refresh_token', { refresh_token: current.refresh_token }));
    save(refreshed);
    return refreshed.access_token;
  } catch {
    save(null);
    return null;
  }
}
