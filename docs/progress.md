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
  - Sandbox play money spent so far: about $2,700 of captures and $0.40 of refunds.

## In progress

- Nothing. Step 4 is committed.

## Open for the owner / notes for later steps

- The rate limiter is per process. A Postgres-backed one (`rate_buckets`) comes
  with `packages/db` (step 5), before web and worker run side by side.
- **Step 5 (db):** load `.data/seed/*.jsonl` into `orders`/`order_items`/`captures`
  (state POOL). `orders.id` is the global primary key while both merchants hold
  mirrored scenarios, so seed refs are split by range (10001+ guarded,
  20001+ baseline). Decide whether Lab fixtures need the same ref on both sides.
  If so, the key must become (merchant, id).
- **Step 8 (ledger):** PayPal item tax is per unit, so an item refund is
  `qty × (unit + tax)`. Spec §7.1's "qty × unit + tax" is only right for qty 1.
- **Step 8/12 (ledger, reconciler):** PayPal keeps request keys for 6 hours
  (Orders v2 spec). Before retrying an UNVERIFIED refund, read the order's
  refunds and match `custom_id`. Never re-POST blindly after 6 h.

## Next action

- §9 step 5: `packages/db`: Postgres in Docker for local dev, migrations
  0001 (§4.5) / 0002 (roles: app cannot UPDATE/DELETE audit_log), migrator,
  typed queries, load the seed manifest, policy v1 row. Needs `DATABASE_URL`
  in `.env.local` (local Docker URL; no owner secret needed).
