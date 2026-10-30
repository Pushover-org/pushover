# Architecture decisions

The full design is in the build spec (§4). This file records decisions made
while building, and why.

## Toolchain

- **pnpm 12.16.1**, pinned with `packageManager` in `package.json`.
  Corepack cannot launch pnpm 12 on Node 24.9 (it looks for `bin/pnpm.cjs`,
  which pnpm 12 no longer ships), and corepack 0.36 requires Node ≥ 24.15.
  A globally installed pnpm 10 reads `packageManager` and switches to
  12.16.1 by itself, so `pnpm` just works inside this repo. CI uses
  `pnpm/action-setup`, which reads the same field.
- **TypeScript 6.0.3**, not 7.x: `typescript-eslint` 8.72.1 declares peer
  `typescript >=4.8.4 <6.1.0`. Revisit when typescript-eslint supports 7.
- **Exact versions only** (no `^`). pnpm 12 refuses releases younger than its
  minimum release age; we pin an older release instead of adding exclusions.
- Packages are TypeScript source with `.ts` import extensions
  (`allowImportingTsExtensions`, `erasableSyntaxOnly`), run directly by
  Node 24's type stripping and by vitest. No build step for libraries.
  To verify in §9 step 10: Next.js resolves these workspace imports.

## Environment variables in a monorepo

There is one secrets file: `.env.local` at the repo root (git-ignored).
Nothing copies it.

- **Node scripts and packages** (day-1 scripts, seed, eval, worker): run with
  `node --env-file-if-exists=<repo root>/.env.local`. A missing file is
  tolerated, so the same command works on Railway, where variables come from
  the service settings.
- **Next.js (`apps/web`)** only reads env files from its own folder, so
  `apps/web/next.config.ts` calls `process.loadEnvFile()` on the root file
  when it exists.
- **Tests** that need credentials (`pnpm test:sandbox`) load the same file the
  same way and skip when the variables are absent.

## Import boundaries (ESLint `no-restricted-imports`, tested in `test/`)

- `packages/agent` may not import PayPal code. The model never moves money.
- `packages/oracle` may not import `packages/ledger`. The scorer stays
  independent of what it scores.

## Database (packages/db)

Schema is spec §4.5 with these deliberate changes:

- **Customers and orders are keyed by (merchant, id).** The Lab sends one message to
  both agents, so a scenario must exist in both stores under the same refs
  ("C-1042", "PO-4417"). Child tables carry `merchant` in their foreign keys.
- **Unassigned pool orders** have `customer_id` and `delivered_at` NULL until fixture
  checkout assigns both (a CHECK keeps them together). Otherwise every pool order
  would have to belong to a fake customer.
- **audit_log is append-only for everyone:** a trigger blocks UPDATE, DELETE and
  TRUNCATE even for the table owner, on top of the `pushover_app` grants (0002).
  On Railway the app may connect as the database owner, so grants alone are not enough.
- **policy rows are written only by migrations** (v1 is `0003_policy_v1.sql`).
  Results are scored against a policy version, so a version is never edited.
- **The migrator** stores a SHA-256 per file and refuses to run if an applied file
  changed. It takes an advisory lock so two deploys cannot migrate at once.
- **Rate limiting:** `rate_buckets` is a per-key lock row and `rate_grants` logs grants,
  giving the same rolling-minute window as packages/paypal, shared by every process
  (`PgRateLimiter`). The spec's token-bucket `tokens` column is not used.
- **Integrity checks in SQL:** USD only; positive amounts; item scope ⇔ item SKU;
  ledger intents only for the guarded store; an eval row is UNVERIFIED exactly when
  `moved_cents` is NULL (unknown never becomes 0).

### Local dev database

- Docker container `pushover-pg` (postgres:17-alpine) on `127.0.0.1:5433`, volume
  `pushover-pg-data`. The URL with its random password is only in `.env.local`.
- It runs on the **`default`** Docker engine. This laptop also has Docker Desktop, which
  may become the current context, so use `docker --context default ...` for it.
- `pnpm db:migrate`, then `pnpm db:seed` (customers + `.data/seed` manifest).
- Tests create a throwaway `pushover_test_*` database per run and drop it. They read
  only `DATABASE_URL` from `.env.local`, not the PayPal or Anthropic keys.
- To verify on Railway (step 10): its Postgres major version; we develop on 17.
