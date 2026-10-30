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

## In progress

- Nothing. Step 2 is committed locally.

## Open for the owner

- First `git push -u origin main` not yet done (waiting for approval). It also
  proves laxmikhengare's push access and triggers the first CI run.
- After the first CI run, check the GitHub About section shows "MIT license".

## Next action

- §9 step 3: `packages/paypal` client + token bucket + unit tests (spec §4.7.1,
  §7.1), then D1-2 and D1-9 against the sandbox, recorded in
  `docs/sandbox-findings.md`.
