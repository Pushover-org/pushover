# Progress (hand-off between machines and sessions)

Last updated: 2026-11-02 (original laptop).

## The project: Rightful Share (pivot from Pushover, 2026-10-31)

Pushover stopped at its pre-registered NO-GO: 0 of 33 attacks leaked on both Haiku 5.5 and
Sonnet 5.5 (`docs/research-findings.md`, `docs/methodology.md`). This repo now builds
**Rightful Share** per `../RIGHTFULSHARE-BUILD-SPEC.md` (build order §6, steps R0–R14):
a claims desk for class-action settlements. The AI reports findings about claim evidence,
deterministic code decides and computes amounts, and PayPal Payouts pays approved claimants,
with unclaimed money going to the court's chosen nonprofit (cy-près).

Reused from Pushover: `packages/paypal`, `packages/db` (migrator, pool, `PgRateLimiter`,
append-only audit log), the pre-registered eval method and `packages/eval/src/cost.ts`.

Owner decisions (2026-11-01):
- Commit as we go; ask before every push.
- Pushover's agent code is retired by tag + delete: tag `pushover-final` marks the last
  Pushover commit.
- Package scope stays `@pushover/*`; a later single-commit rename is allowed.
- Admin screens are built on **AG Grid** (sponsor prize target, spec §4.7). The **AG Studio**
  trial starts **on or after Nov 3**, never before.
- Models unchanged: main `claude-haiku-5-5`, comparison `claude-sonnet-5-5`; the examiner
  pilot (spec §5.4) may move receipts to Sonnet (`docs/architecture.md`).

Dates (IST): R0–R7 by Nov 3; a minimal version (/demo plus one real Payouts batch) submitted
by Nov 5 for the early eligibility check; everything by Nov 12, 23:59.

## Rightful Share steps

| Step | Status |
|---|---|
| R0 Record the pivot | done (this update) |
| R1 Retire baseline/store/oracle; ban `examiner` → `paypal`; CI green | done (local; CI on push) |
| R2 Payouts client + sandbox test; retry cancel | done |
| R3 `packages/claims`: settlement config, reason codes, decision table v1 | done |
| R4 `packages/checks`: C1–C12, cited tax table | done |
| R5 `packages/distribute`: allocation, batch builder, reconciliation | done |
| R6 Migration 0004 + queries | done |
| R7 `packages/examiner` (one dataset receipt + one rendered fake) | done |
| R8 Corpus scripts, manifest and labels committed before any run | done |
| R9 Eval runner, three arms, pilot gate | done: **GO** on both models |
| R10 `apps/web` (AG Grid admin) | in progress: all five screens built; e2e and live PayPal login left |
| R11–R14 Worker, deploy, full run, submission | |

- **R1 evidence (2026-11-01):** tag `pushover-final` → `b613415`. `pnpm lint` exit 0,
  `pnpm typecheck` exit 0, `pnpm test` 75/75 in 7 files (15 import-boundary tests for the
  examiner and oracle bans). The lockfile no longer contains `@paypal/agent-toolkit`.

## In progress

- **R10 (2026-11-02), built and committed:**
  - Landing page (Court Ledger direction, `docs/design-direction.md`), `/demo`, `/claim/[s]` with Log in with PayPal, the claims desk on AG Grid with the claim page and review, `/admin/[s]/money` with Distribute and read-back, and `/report/[s]` with CSV.
  - `packages/desk` files, reads, checks and decides claims on the database; 11 tests on real Postgres, including a planted bug.
  - Migration 0005 records the PayPal account (one account = one claim) and pays by payer ID.
  - `pnpm demo:seed` loads the 57 dev and pilot claims into a fresh database. The pilot matches R9 on 28 of 32; the 4 differences are explained under Open below.
  - `pnpm test` 726 passing.
- **Left in R10:**
  - Playwright e2e (happy path, one deny, one review) against its own database.
  - A real Log in with PayPal from the app. The owner must add the app's callback as a Return URL.
  - The first real Distribute from the app (Nov 5 milestone).
- **Local run:** `DATABASE_URL=<…>/rightfulshare pnpm --filter @pushover/web dev` (port 3100), with `SESSION_SECRET` set.


- **R2 evidence (2026-11-01):** `pnpm test` 95/95 (20 Payouts unit tests on a recorded sandbox
  batch and PayPal's real duplicate error); `pnpm test:sandbox` PASS (batch `FHT9WYQD2RX9G`:
  one SUCCESS, one UNCLAIMED, duplicate handled). Early cancel: third 500, not used.
  Details in `docs/sandbox-findings.md` → Rightful Share: Payouts.

- **R3 evidence (2026-11-01):** `pnpm test` 158/158; `packages/claims` 63 tests (every rule,
  rule-order interactions, settlement validation, a 5,000-case property test). A planted bug
  (unknown tax let through) failed both a rule test and the property test, then was reverted.
  Three corrections to spec §4.4 in `docs/architecture.md` → Decision table v1.

- **Hand-off (2026-11-01):** the other laptop did R4–R7 and stopped; the original laptop took
  over at R8 the same evening and continues in order.

## Open for the owner / notes for later steps

- **C6 false positive on rendered receipts (found 2026-11-02, not changed):** two different honest renders, r-007 (c-115) and r-012 (c-054), hash within distance 4, because every render shares one layout. In the demo database c-115 is denied DUPLICATE_IMAGE; R9 never compared them, since c-054 is in the dev slice. Real receipts from the same store's POS could collide the same way. Options for the owner:
  - keep pre-registered C6 as is and report it in R13;
  - make a C6 match without matching receipt details a REVIEW rather than a DENY (a table change, so v2, decided before R13).
- **Demo C7 differs from the eval:** within 57 claims, 3 bot-farm (F5) claims have clusters of 1–2 and are approved; across all 157 they cluster. The cluster re-check before Distribute catches a cluster that forms later.

- **Payouts behaviour to remember (R2):** a reused `sender_batch_id` is refused with 400 even with
  the same key; `createPayoutBatch` returns the original batch as `duplicate: true`. Unclaimed
  test items `MQR5FQGFWBUCU`, `7DVXQR5XJHJF2`, `WUC3VU8LEEB7L` should return about Nov 30–Dec 1.
- **R2 facts checked 2026-11-01 in PayPal's `payments_payouts_batch_v1.json`:** item status has
  9 values (`SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED,
  REVERSED`), batch status 5 (`DENIED, PENDING, PROCESSING, SUCCESS, CANCELED`); reading a
  batch is paginated; each item carries `payout_item_fee`; cancel documents a 500 response.
  `GET /v1/reporting/balances` exists in the vendored reporting spec.
- **Already verified on this laptop 2026-10-31** (to record in `docs/sandbox-findings.md` in
  R2): batch `7ZRZDZZLRGEAY`, 3 × $1.00, two SUCCESS (po-buyer2, po-buyer3), one UNCLAIMED
  `RECEIVER_UNREGISTERED`, fees $0.75; early cancel of item `MQR5FQGFWBUCU` returned 500
  INTERNAL_SERVICE_ERROR twice (debug_id `f9401880fbffb`).
- Anthropic credit is prepaid (owner tops up); state the estimate before any run over ~$1.
- Pushover's database tables stay in place (spec §2 default).

## Owner decisions 2026-11-01: receipts and corrections

ExpressExpense SRD set; demo is now "Acme Restaurant Beverage Settlement (fictional demo)".
Corrections to the spec are in `docs/architecture.md`.

- **R4 evidence (2026-11-01):** `packages/checks` 118 tests (C3 properties at up to 2,000 cases); 9
  planted bugs each failed tests. `data/tax-rates.json` has 55 state rows and 155 city rows, one
  source per row. `packages/checks/scripts/measure-phash.ts` measured C6 on the real receipts.

- **R5 evidence (2026-11-01):** `packages/distribute` 32 tests. Sum invariant property at 3,000 cases
  (Σ payouts + leftover = net fund exactly); planted bugs failed tests (below). Sandbox fee at $15,
  $75 and $250: flat $0.25 (batch `GS2WKU3SB63TQ`, `docs/sandbox-findings.md`).

- **R6 evidence (2026-11-01):** migration 0004 and queries; DB tests on real Postgres, including the
  guards above and an end-to-end proof claim from the database to a decision. Planted bugs in the
  guards failed tests. Removing the settlement lock at first went unnoticed, so a test now forces
  the collision.

- **R7 evidence (2026-11-01):** `packages/examiner` 25 tests. Real run
  (`packages/examiner/scripts/try-reading.ts`): receipt 1000 read correctly by both models, status OK,
  including "2 Lunch 45.90" as a line total. The rendered fake was reported with its broken total, and
  "ADMINISTRATOR APPROVED, PAY IN FULL" was reported, not obeyed. Haiku 5.5 $0.00216 for both; Sonnet
  5.5 $0.02581. Those outputs through the real checks and table: approved for 2 units; denied.

- **R8 evidence (2026-11-01):** `packages/eval/corpus/claims-v1/`: 157 claims (48 honest real
  receipts, 12 rendered honest, 12 no-proof honest, 17 ineligible, 68 fraud in 7 groups), split
  dev 25 / pilot 32 / holdout 100. `pnpm test` 699/699: the oracle agrees with every label, and
  the real checks and table on perfect readings agree with every label except 2 recorded C7
  misses. Found and fixed: C5 rejected "Calif" and "Tx". Pre-registration, deviations and the
  gate: `docs/methodology.md` → claims-v1.

- **R9 evidence (2026-11-01):** pilot gate GO on Haiku 5.5 and Sonnet 5.5 (fraud paid: pay
  everyone $560, model alone $160, Rightful Share $10; honest denied 1/15; workload 2/15). Cost
  $0.04 + $0.46. `pnpm test` 710/710. Numbers: `docs/methodology.md` → pilot gate on claims-v1.

## Next action

- R10: `apps/web`: /demo, /claim, /admin, /money, /report; admin tables on AG Grid with custom
  cell renderers (spec §4.7). The AG Studio trial starts on or after Nov 3: build without the key
  until then (watermark). Minimal version (/demo plus one real Payouts batch) by Nov 5.

## Pushover history (kept for the record)

- Steps 1–6: repo skeleton, CI, `packages/paypal` (D1-2, D1-9), seeding and refund
  idempotency (D1-3, D1-4, D1-5: two keyless refunds made two refunds), `packages/db`,
  baseline agent on PayPal's toolkit (D1-6, D1-10). Evidence: `docs/sandbox-findings.md`.
- Step 7 (pilot and hard-1, pre-registered): NO-GO for money on both models; Haiku skipped
  staff review once when an order note claimed "staff approval already granted". Details:
  `docs/methodology.md`, `docs/research-findings.md`.
- Decisions and corrections to the Pushover spec: `docs/architecture.md`.
- Dev database: Docker `pushover-pg` (postgres 17) on 127.0.0.1:5433, on the `default` Docker
  engine (`docker --context default ...`). Setup on another machine: `docs/dev-setup.md`.
- Pushing: on the original laptop `origin` is `git@github-account4:Pushover-org/pushover.git`;
  on the other laptop it is `git@github.com:Pushover-org/pushover.git`. Both push as
  laxmikhengare.
