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

## AI models (owner decision 2026-10-30)

- **Main model: `claude-haiku-5-5`** (`PUSHOVER_MODEL`): the live Lab, both agents, and
  the headline numbers. **Comparison: `claude-sonnet-5-5`** (`COMPARE_MODEL`), a second
  column in the results. This replaces the spec's Opus 5.5 / Sonnet 5.5 pair, for cost.
- Fairness rule unchanged: both agents always run the same model with the same settings.
- Why: list prices per 1M tokens (input/output) are Haiku 5.5 $0.10/$0.50 (prompts up to
  100K tokens), Sonnet 5.5 $2/$10, Opus 5.5 $4/$20. With spec §5.6.6's assumption
  (≈18k input + 3k output per message per agent), one Lab message costs ≈ $0.0066 for both
  agents on Haiku (vs ≈ $0.26 on Opus), so the $15/day cap allows ≈ 2,200 messages a day and
  the Lab should not pause during judging. The 3-seed headline run is ≈ $5 (Haiku) + ≈ $103
  (Sonnet) ≈ $108, vs ≈ $309 planned. The 20-item pilot (§9 step 17) measures the real cost.
- Sonnet in the results answers "the baseline only leaks because the model is small".
- Verified 2026-10-30: `GET /v1/models/{id}` returns 200 for both IDs with this key
  (1M input tokens, 128K max output).
- To check in step 6 (D1-6) and step 9, not assumed:
  - Haiku 5.5: thinking is on by default, default effort `medium`; non-default sampling
    parameters return 400 (does `ai@4` send a temperature?).
  - Haiku 5.5 has **no server-side refusal fallback**, so spec §5.2's `fallbacks: "default"`
    does not apply to the main model; handle `stop_reason: "refusal"` in code.
  - Use `tool_choice: auto` on both models (forced tool choice returns 400 on Sonnet 5.5).

## Shared store pieces (packages/store)

Not in spec §4.3's layout. Both agents must get the same system prompt (apart from the refund
paragraph), the same written policy and the same `lookup_my_orders` backed by the same DB
(fairness contract, spec §5.3.1). Putting them in one package makes that a fact, not a promise:
a test checks the two prompts differ only in the refund paragraph, and that the policy text
equals `docs/policy.md`. `lookup_my_orders` adds PayPal order and capture IDs only for the
baseline, because the toolkit's tools need them.

## Baseline call settings

The baseline passes `temperature: 1` to `generateText`; everything else is PayPal's example.
`ai@4` otherwise sends temperature 0, which Haiku 5.5 and Sonnet 5.5 reject (D1-6 in
`docs/sandbox-findings.md`). 1 is the API default, so both agents run at the model's default.
