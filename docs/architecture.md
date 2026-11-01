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

- `packages/examiner` may not import PayPal code (`@pushover/paypal`, `@paypal/*`, or a
  relative path into `packages/paypal`). The model reports findings; it never decides a claim
  and never pays (Rightful Share spec §0.1 rule 7).
- `packages/eval/src/oracle` may not import `claims`, `checks`, `distribute` or `examiner`.
  The oracle checks the corpus labels against the rules as written, independently of the code
  it checks (spec §5.1). The rest of `packages/eval` may import them: arm C runs the real
  decision table.
- (Pushover's bans, `agent` → PayPal and `oracle` → `ledger`, retired with that code at tag
  `pushover-final`.)

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

## Shared store pieces (packages/store; Pushover, retired at tag `pushover-final`)

Not in spec §4.3's layout. Both agents must get the same system prompt (apart from the refund
paragraph), the same written policy and the same `lookup_my_orders` backed by the same DB
(fairness contract, spec §5.3.1). Putting them in one package makes that a fact, not a promise:
a test checks the two prompts differ only in the refund paragraph, and that the policy text
equals `docs/policy.md`. `lookup_my_orders` adds PayPal order and capture IDs only for the
baseline, because the toolkit's tools need them.

## Baseline call settings (Pushover, retired at tag `pushover-final`)

The baseline passes `temperature: 1` to `generateText`; everything else is PayPal's example.
`ai@4` otherwise sends temperature 0, which Haiku 5.5 and Sonnet 5.5 reject (D1-6 in
`docs/sandbox-findings.md`). 1 is the API default, so both agents run at the model's default.

## Decision table v1 (packages/claims, Rightful Share)

`decide()` is pure: no I/O, no clock, no model. Its input has no field for the examiner's own
approve/deny recommendation, and a test fails if the word appears in the decision code. Rules,
first match wins (spec §4.4, with the corrections marked *):

0. * Proof claim whose examiner run was INVALID, REFUSED or NOT_RUN → REVIEW (spec §4.2 says an
   invalid reading goes to REVIEW; it has to come first, or its UNKNOWN checks would ask the
   claimant for documents they already sent).
1. Proof claim with C1, C2, C3 or C4 FAIL → DENY (first in that order). * **C5 (geography) FAIL
   denies every claim.** As written, a no-proof claim failing C5 matched neither rule 1 (evidence
   only) nor rule 6 (needs C5 passing) and fell through to rule 7, "approve at the proof tier".
2. C6 (proof only) or C8 FAIL → DENY as a duplicate.
3. C7 or C9 FAIL → REVIEW (cluster).
4. Proof claim: C10 FAIL or examiner confidence low → REVIEW.
5. * **UNKNOWN the claimant can fix** (C1 date, C2 product, C3 totals, C5 address/store) →
   NEED_MORE, naming the document.
6. * **UNKNOWN on our side** (C4 tax table has no row for the state, C6 image hash, C7, C8, C9
   lookups, C10, C11) → REVIEW. Asking the claimant for paperwork cannot fix these, and unknown
   is never a pass.
7. No-proof claim → APPROVE, flat amount, 1 unit.
8. Proof claim → APPROVE, units capped at the tier maximum (C11 FAIL caps, never denies).

- Which checks apply: all of C1–C11 for proof claims; C5, C7, C8, C9, C11 for no-proof claims.
  A missing applicable check counts as UNKNOWN.
- Every decision records `version: "decision-v1"`, the matching rule, a reason code with a
  court-readable sentence (`REASONS`), and the check results it saw.
- Property test (5,000 random cases): APPROVE only when every applicable check passed (C11 may
  FAIL, meaning capped), and with evidence only after a clean, confident examiner run.
- Settlement config (`SettlementSchema`, zod 4.6.7): USD only, integer cents, class period start
  ≤ end, unique product IDs, 50 states + DC, reserve below the fund, no-proof amount at most the
  proof maximum. A demo settlement's name must contain "(fictional demo)" and its cy-près
  recipient "(demo)" (spec rule 8).

## Receipt source and demo settlement (owner decision 2026-11-01)

The owner has no receipts to photograph, so spec §5.1's H1 and §7.3 change. Real receipts come
from the **ExpressExpense SRD** dataset: 200 phone photos of US restaurant receipts, MIT licence,
credit "ExpressExpense.com" (`data/receipts/README.md`).

- **Images are never committed.** `pnpm receipts:download` checks the md5 and unzips them into
  git-ignored `.data/receipts/expressexpense/`.
- **Copies inside the set** are listed in `data/receipts/expressexpense-duplicates.json`; only the
  `keep` file of a group may enter a corpus.
- **Demo settlement (changed the same day, see below):** "Acme Restaurant Beverage Settlement
  (fictional demo)". Qualifying product: any non-alcoholic drink bought at a restaurant. The
  restaurants on the receipts are never the defendant. Class period and states cover the receipts
  chosen for H1; the fixture holds 2015-01-01 to 2019-12-31 and CA, CT, FL, MI, NJ, NY, SC, TX, WA
  until the H1 list is committed.
- **The rest of the set is used too:** real receipts dated outside the class period become real
  F1 claims, and real receipts with no qualifying drink become real "no qualifying product" claims
  (expected DENY), labelled as such.
- **R4 tax table:** restaurant and prepared-food sales tax for those states, with local rates,
  as ranges where the city is unknown, and **the rates in force on the receipt's date**, not
  today's. So rows carry effective dates, and C4 needs `purchase_date`.
- **C5:** a receipt with no printed state is UNKNOWN (the claimant can fix it, so NEED_MORE under
  rule 5). The state is never inferred from a phone area code.
- **R7** uses one of these receipts plus one rendered fake. **R8 H1** uses the 26 usable drink
  receipts (OCR count; each is checked by eye when the list is committed).

### What the set showed when it was checked (2026-11-01)

OCR here means macOS Vision on this laptop, which costs no AI credit; it is a count, not a label.

- md5 matches; 200 JPGs; widths 245 to 1174 px (median 750), 73 under 600 px.
- **Copies:** `1034 = 1041 = 1114` (byte-identical). `1186 = 1063 = 1053` (same receipt).
- **Only 12 receipts** have a coffee or espresso line plus a state, a date, a subtotal, tax and a
  total (OCR). 26 do if the product is any non-alcoholic drink, which is why the owner widened
  the product from coffee.
- **pHash cannot catch a re-crop.** `1053` and `1186` are the same receipt at pHash distance 26,
  while 2,271 of 19,900 file pairs are closer; different receipts reach distance 8 (`1173`/`1199`
  share no OCR text). Rotations and re-encodes are a separate question, tested in R4.
- **Honest receipts break the checks as specified.** `2 Lunch 45.90` prints a line total, not a
  unit price. `1099` prints a second total with an 18% gratuity. `1084` (Hoboken NJ, 2018-07)
  charged 7.00% when the state rate was 6.625% (Tax Foundation 2018). `1099` (San Jose, 2017-12)
  charged 10.91%; the rate in force is still to be read from CDTFA. These receipts are real, so
  whether they pass is measured, never fixed by leaving them out of H1.

## Corrections to spec §4.2–§4.5 (owner decisions 2026-11-01)

These win over the spec. `DECISION_VERSION` stays `decision-v1`: no decisions have run yet.

**Decision table (`packages/claims`), replacing the rules listed in "Decision table v1" above where
they differ:**
- **Low confidence moves up.** Rule 0 now also sends a proof claim with examiner confidence `low`
  to REVIEW `LOW_CONFIDENCE`, before any denial. Otherwise a misread number fails a check at rule 1
  and denies an honest person. Rule 4 is now C10 only. A side effect to remember: a low-confidence
  claim that would also fail C5, C6 or C8 goes to REVIEW, not DENY.
- **Units are capped by the evidence.** Rule 8 pays for the lowest of units claimed, units the
  evidence shows (`unitsEvidenced`) and the tier maximum. Before this, a receipt for 1 unit could
  claim 5 and be paid for 5. No evidenced units at rule 8 → REVIEW on C11.
- **New check C12, repeat receipt details:** same merchant, date and total as another claim →
  REVIEW `REPEAT_RECEIPT_DETAILS`, never DENY, because it rests on what the model read. It exists
  because a re-cropped copy defeats the perceptual hash. Proof claims only. Only C6 denies a
  duplicate receipt.
- **C4 UNKNOWN has its own reason,** `TAX_UNCONFIRMED`, so a court reads why it was held.

**Findings (`FindingsSchema`, moved to `packages/claims` so checks and examiner share it):**
- Each line has a printed `line_total_cents`, and `qty` and `unit_cents` may be null: "2 Lunch
  45.90" prints a line total.
- `adjustments[]` holds printed discounts, fees and tips, marked before or after the subtotal.
- Each visual anomaly has its own `confidence`; C10 fails only on one marked `high`.

**Checks (`packages/checks`):**
- C3 uses printed line totals and adjustments. With no printed subtotal it checks line items + tax
  = total. See that package for how unpriced lines and tips are handled.
- C4 stays two-sided, because restaurant meals are generally taxed (to be confirmed per state in
  `data/tax-rates.json`). Tax outside the limit by no more than a margin → UNKNOWN (REVIEW); further
  outside → FAIL (DENY). Real shops overcharge: receipt 1084 charged 7.00% where the state rate was
  6.625%. The margin is set on the dev slice.
- C6 hashes all four rotations; the threshold must stay below 8, because different receipts in the
  set come that close. Only a hash match denies.
- C7 and C9 are symmetric, not "earlier claims only", and are re-run across all claims before
  Distribute, so the first members of a cluster are held too.
- C8: a match with an approved claim → FAIL; with a claim still pending → UNKNOWN (REVIEW). Check
  and decide run one at a time per settlement (R6).

**Reconciliation (`packages/distribute`):** buckets are mutually exclusive and include `unverified`.
Spec §1.3's equation double-counts money that returns and then goes to cy-près.

**Gate wording:** spec §5.4's "honest wrongly denied ≤ 10%" is the measured rate on the pilot slice,
not the Wilson upper bound. Wilson intervals are still reported (§5.3).
