import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { migrate } from "../src/migrate.ts";

/** DATABASE_URL from the environment, else ONLY that one value from the repo's .env.local. */
function baseUrl(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const file = new URL("../../../.env.local", import.meta.url);
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8"))["DATABASE_URL"] : undefined;
}

export const DATABASE_URL = baseUrl();
if (!DATABASE_URL && process.env["CI"]) throw new Error("CI must provide DATABASE_URL for database tests");

/** A fresh, migrated database that is dropped afterwards. Dev data is never touched. */
export async function freshDatabase(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const name = `pushover_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(DATABASE_URL!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await migrate(pool);
  return {
    pool,
    drop: async () => {
      await pool.end();
      const a = new pg.Client({ connectionString: DATABASE_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
