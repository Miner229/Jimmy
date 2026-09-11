import { createClient } from "@supabase/supabase-js";
import { database, one } from "./db.js";
import { HttpError } from "./domain.js";
export function authClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    throw new HttpError(
      503,
      "Sign-in service is not configured yet.",
      "SERVICE_NOT_CONFIGURED",
    );
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticate(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "Please sign in to continue.");
  const { data, error } = await authClient().auth.getUser(bearer);
  if (error || !data.user)
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  const u = data.user;
  return one(
    database(),
    `insert into users(id,email,full_name,email_verified_at) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,email_verified_at=excluded.email_verified_at returning *`,
    [
      u.id,
      u.email,
      u.user_metadata?.full_name || "",
      u.email_confirmed_at || null,
    ],
  );
}
