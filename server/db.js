import pg from "pg";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { HttpError } from "./domain.js";
let pool;
export const uuid = () => randomUUID();
export const token = () => randomBytes(32).toString("hex");
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export function database() {
  if (!process.env.DATABASE_URL)
    throw new HttpError(
      503,
      "Account and Club services are not configured yet.",
      "SERVICE_NOT_CONFIGURED",
    );
  return (pool ||= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10000,
  }));
}
export async function transaction(fn) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export const one = async (db, sql, args = []) =>
  (await db.query(sql, args)).rows[0];
export async function audit(db, user, club, event, target, metadata = {}) {
  await db.query(
    "insert into audit_events(id,actor_user_id,club_id,event_type,target,metadata) values($1,$2,$3,$4,$5,$6)",
    [uuid(), user?.id || null, club, event, target, JSON.stringify(metadata)],
  );
}
export async function rateLimit(key, limit = 20) {
  const r = await one(
    database(),
    `insert into rate_limits(key,hits,expires_at) values($1,1,now()+interval '15 minutes') on conflict(key) do update set hits=case when rate_limits.expires_at<now() then 1 else rate_limits.hits+1 end,expires_at=case when rate_limits.expires_at<now() then now()+interval '15 minutes' else rate_limits.expires_at end returning hits`,
    [hash(key)],
  );
  if (r.hits > limit)
    throw new HttpError(429, "Too many attempts. Please try again later.");
}
