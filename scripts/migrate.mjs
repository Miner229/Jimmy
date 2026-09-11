import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL before running migrations.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("select pg_advisory_lock(418102)");
  await client.query(
    "create table if not exists schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())",
  );
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`db/migrations/${name}`, "utf8"),
      checksum = createHash("sha256").update(sql).digest("hex");
    const existing = (
      await client.query(
        "select checksum from schema_migrations where name=$1",
        [name],
      )
    ).rows[0];
    if (existing) {
      if (existing.checksum !== checksum)
        throw Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "insert into schema_migrations(name,checksum) values($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query("select pg_advisory_unlock(418102)");
  await client.end();
}
