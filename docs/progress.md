# Progress (hand-off between machines and sessions)

Last updated: 2026-11-01.

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
| R3 `packages/claims`: settlement config, reason codes, decision table v1 | next |
| R4 `packages/checks`: C1–C11, cited tax table | |
| R5 `packages/distribute`: allocation, batch builder, reconciliation | |
| R6 Migration 0004 + queries | |
| R7 `packages/examiner` (needs ≥ 1 real receipt photo from the owner) | |
| R8–R14 Corpus, eval + pilot gate, web, worker, deploy, full run, submission | |

- **R1 evidence (2026-11-01):** tag `pushover-final` → `b613415`. `pnpm lint` exit 0,
  `pnpm typecheck` exit 0, `pnpm test` 75/75 in 7 files (15 import-boundary tests for the
  examiner and oracle bans). The lockfile no longer contains `@paypal/agent-toolkit`.

## In progress

- **R2 evidence (2026-11-01):** `pnpm test` 95/95 (20 Payouts unit tests on a recorded sandbox
  batch and PayPal's real duplicate error); `pnpm test:sandbox` PASS (batch `FHT9WYQD2RX9G`:
  one SUCCESS, one UNCLAIMED, duplicate handled). Early cancel: third 500, not used.
  Details in `docs/sandbox-findings.md` → Rightful Share: Payouts.

- Nothing in progress. R0–R2 are committed.

## Open for the owner / notes for later steps

- **R7:** at least one real receipt photo (card digits covered) is needed for R7's check;
  about 30 for R8.
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

## Next action

- R3: `packages/claims`: settlement config schema (zod 4, verify the version), reason codes,
  decision table v1 (spec §4.4), one test per row and per rule-order interaction.

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
