// Supabase access over HTTPS (no SDK dependency).
// - Database: calls the payments_* Postgres functions through the Data API
//   (/rest/v1/rpc/<name>) with the server-only secret key.
// - Auth: verifies a user's access token with GET /auth/v1/user.

export class DatabaseError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DatabaseError';
    this.status = status;
  }
}

function serverHeaders(secretKey) {
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys do not.
  if (secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

export function createDatabase({ url, secretKey, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  async function rpc(name, args = {}) {
    if (!/^payments_[a-z_]+$/.test(name)) throw new DatabaseError(`Unexpected function name ${name}`);
    let response;
    try {
      response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: serverHeaders(secretKey),
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DatabaseError('Could not reach the database', 0);
    }
    const text = await response.text();
    if (!response.ok) {
      let message = `Database call ${name} failed (${response.status})`;
      try {
        const err = JSON.parse(text);
        if (err.message) message = `${name}: ${err.message}`;
      } catch { /* keep the generic message */ }
      throw new DatabaseError(message, response.status);
    }
    return text ? JSON.parse(text) : null;
  }
  return { rpc };
}

export function createAuthVerifier({ url, publishableKey, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  // Returns { id, email } for a valid access token, or null.
  return async function getUser(accessToken) {
    if (!accessToken || accessToken.length > 4096) return null;
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/user`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DatabaseError('Could not reach the authentication service', 0);
    }
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new DatabaseError(`Authentication check failed (${response.status})`, response.status);
    const user = await response.json();
    if (!user?.id) return null;
    return { id: user.id, email: user.email || null };
  };
}
