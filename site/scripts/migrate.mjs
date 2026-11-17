// Applies db/migrations/*.sql in name order, once each, recording them in schema_migrations.
// Run with: pnpm db:migrate (reads DATABASE_URL from the environment or .env.local; never prints it).
import { readdirSync, readFileSync } from "node:fs"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("migrate: DATABASE_URL is not set (run `neon env pull` or `vercel env pull` first)")
  process.exit(1)
}
const dir = new URL("../db/migrations/", import.meta.url)
const files = readdirSync(dir).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
  for (const name of files) {
    await client.query("BEGIN")
    try {
      // The row lock on the insert makes two concurrent runs apply each file once.
      const { rowCount } = await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name])
      if (rowCount === 1) await client.query(readFileSync(new URL(name, dir), "utf8"))
      await client.query("COMMIT")
      console.log(`migrate: ${name} ${rowCount === 1 ? "applied" : "already applied"}`)
    } catch (error) {
      await client.query("ROLLBACK")
      console.error(`migrate: ${name} failed: ${error instanceof Error ? error.message : "unknown error"}`)
      process.exitCode = 1
      break
    }
  }
} finally {
  await client.end()
}
