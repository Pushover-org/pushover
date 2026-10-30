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

## In progress

- Nothing. Step 3 is committed.

## Open for the owner

- The limiter is per process for now. A Postgres-backed one (spec §4.7.1
  `rate_buckets`) comes with `packages/db` (step 5), before web and worker run
  side by side.

## Next action

- §9 step 4: D1-3 seeding path (card source, spec §3.6 Path A). Needs a sandbox
  test card from Developer Dashboard → Testing Tools → Credit Card Generator
  (never invent card numbers). Then `scripts/seed.ts`, then D1-4 / D1-5
  (refund with and without a PayPal-Request-Id).
