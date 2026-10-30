# Progress (hand-off between developers)

Last updated: 2026-10-30.

## Done

- **§9 step 1:** Day-0 PayPal sandbox setup, checkpoint D1-1 passed (spec §3.0).
- **§9 step 2:** repo skeleton.
  - pnpm 12.16.1 workspace, TypeScript 6.0.3, ESLint 10.13.0 with the
    agent→PayPal and oracle→ledger import bans, vitest 5.0.5,
    Playwright 1.64.1 (config only; specs arrive with `apps/web`).
  - MIT `LICENSE`, `.env.example`, extended `.gitignore`.
  - `.github/workflows/ci.yml`: frozen install, lint, typecheck, unit tests.
  - Evidence (local, 2026-10-30): `pnpm lint` exit 0; `pnpm typecheck` exit 0;
    `pnpm test` 9/9 passed (`test/import-boundaries.test.ts`); a real file in
    `packages/agent` importing `@pushover/paypal` fails lint.
  - Why versions differ from the spec: see `docs/architecture.md`.

  - Pushed 2026-10-30; first GitHub CI run passed; GitHub detects the MIT license.
- **§9 step 3:** `packages/paypal`.
  - Client (cached OAuth token, single-flight, refresh on 401/403
    NOT_AUTHORIZED), required `PayPal-Request-Id` on every POST kept across
    retries, unknown POST outcomes never reported as failures, a sliding-window
    rate limiter (≤ 40 per rolling minute), integer-cent money, refund/capture/
    order calls. PayPal OpenAPI specs vendored in `docs/paypal-specs/`.
  - Evidence: `pnpm test` 47/47 passed (9 boundary + 38 paypal).
  - **D1-2 PASS** and **D1-9 PASS** against the sandbox: outputs in
    `docs/sandbox-findings.md`.

- **§9 step 4:** seeding path and refund idempotency.
  - **D1-3 PASS:** card-source orders capture in one call, so seeding uses **Path A**.
  - **D1-4 PASS:** same key → same refund. Same key with a different amount
    silently returns the original refund; `refundCapture` now throws
    `PayPalRefundMismatchError` on any amount mismatch.
  - **D1-5:** two keyless refunds → two refunds (risk confirmed, evidence for §10).
  - `pnpm seed` ran: 20 captures per merchant, refs PO-10001..10020 (guarded) and
    PO-20001..20020 (baseline), manifest in git-ignored `.data/seed/`.
    Re-send of PO-10002 returned the same order and capture.
  - Evidence: `pnpm test` 53/53; script outputs in `docs/sandbox-findings.md`.
  - Sandbox play money moved so far: $3,587.28 captured (40 seed orders $3,581.28
    + 6 day-1 orders at $1.00) and $0.40 refunded. Merchants started at $10,000 each.

- **§9 step 5:** `packages/db`.
  - Migrations 0001 (schema, keyed by store + id; append-only audit_log trigger),
    0002 (`pushover_app` role), 0003 (policy v1), checksummed migrator, typed
    queries, Postgres-backed shared rate limiter. Changes from spec §4.5 are listed
    in `docs/architecture.md` → Database.
  - Dev DB: Docker `pushover-pg` (postgres 17.11) on 127.0.0.1:5433, on the
    **default** Docker engine (`docker --context default ...`; Docker Desktop may be
    the current context). `pnpm db:migrate` then `pnpm db:seed`.
  - Dev DB loaded: 6 customers per store, 40 POOL orders (20 per store). Four rows
    checked against PayPal GET order: capture IDs and amounts match.
  - Evidence: `pnpm test` 69/69 (16 db tests on real Postgres; CI has a postgres service).

- **§9 step 6:** `packages/baseline` (Path A) + shared `packages/store` (prompt, policy, lookup).
  - **D1-10 PASS:** toolkit still 1.11.0; config keys as in spec.
  - **D1-6:** PayPal's example as-is → 400 ("`temperature` is deprecated for this model":
    ai@4 sends temperature 0). With `temperature: 1` (API default) → **PASS** on Haiku 5.5
    and Sonnet 5.5: the agent refunded via `create_refund` with an amount it chose; PayPal
    confirms. Path B not needed. Outputs in `docs/sandbox-findings.md`.
  - Measured: one legit turn ≈ $0.0012 on Haiku, ≈ $0.033 on Sonnet.
  - Evidence: `pnpm test` 75/75.

## In progress

- Nothing. Step 6 is committed.

## Open for the owner / notes for later steps

- `.env.local` had an existing `DATABASE_URL=` line that step 5 replaced without
  reading it first. It was most likely the empty template placeholder; if it held a
  real value, restore it under another name.
- **Step 8 (ledger):** PayPal item tax is per unit, so an item refund is
  `qty × (unit + tax)`. Spec §7.1's "qty × unit + tax" is only right for qty 1.
- **Step 8/12 (ledger, reconciler):** PayPal keeps request keys for 6 hours
  (Orders v2 spec). Before retrying an UNVERIFIED refund, read the order's
  refunds and match `custom_id`. Never re-POST blindly after 6 h.
- **Step 10 (deploy):** check Railway's Postgres major version (dev uses 17), create
  a login role that is a member of `pushover_app` for the app, and use the
  `PgRateLimiter` (key per sandbox) in web and worker instead of the in-memory one.
- The pool holds 20 captures per merchant; spec §3.6 wants ≥150 for the eval. The
  worker's replenisher (step 12) tops it up; `pnpm seed --count N` works meanwhile.

- **AI models (owner decision 2026-10-30):** main `claude-haiku-5-5`, comparison
  `claude-sonnet-5-5` (was Opus 5.5 / Sonnet 5.5). Reasons and step-6 checks in
  `docs/architecture.md` → AI models. `.env.local` updated; key verified via Models API.

## Next action

- §9 step 7: pilot corpus (20 items: A1, A2, A4, A5, A7 + 5 legit, labels written and
  committed BEFORE any run), `packages/oracle` (independent of the ledger), a minimal
  scorer that reads refunds back from PayPal, and fixture checkout. Run the **baseline
  only** (spec says Sonnet; with the owner's model choice run Haiku 5.5, plus Sonnet if
  budget allows: ≈ $0.03 per item on Sonnet). GO/NO-GO: baseline must leak money on at
  least 2 of the 5 attack classes, else reframe (spec §9 step 7). Record the result in
  `docs/methodology.md` either way.
