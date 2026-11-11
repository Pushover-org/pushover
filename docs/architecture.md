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

- `packages/examiner` may not import PayPal code (`@proofofclaim/paypal`, `@paypal/*`, or a
  relative path into `packages/paypal`). The model reports findings; it never decides a claim
  and never pays (Proof of Claim spec §0.1 rule 7).
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

## Decision table v1 (packages/claims, Proof of Claim)

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
  set come that close (code refuses 8 or more). Only a hash match denies. Measured on the 196
  distinct real receipts (`packages/checks/scripts/measure-phash.ts`): at threshold 4, 100% of
  recompressed, half-size and exactly rotated copies are caught, and no receipt wrongly matches
  another. But only 4% of copies cropped 3% per side and 1% of copies tilted 2 degrees are caught,
  and none cropped 8% or tilted 5 degrees. **The spec's "re-cropped" copies get past C6;** C12 sends
  them to a person if the model reads the same merchant, date and total. R8's F4 labels follow this.
- `data/tax-rates.json` (`tax-rates-v1`) holds rates in force on the date, one source per row. CA
  comes from CDTFA's archive by period; rows were rebuilt from word positions in the PDFs and agree
  with the tax on real receipts. Other states are ranges from the Tax Foundation's January 1 tables,
  plus the meals taxes named in each row's note. Its "max local" cannot simply be added: for CA in
  2018 it gives 9.75% where CDTFA lists 10.25%, and for NJ it is Salem County's lower rate.
- C4: zero tax → UNKNOWN (REVIEW), because some sales are exempt, such as hot coffee to go in CA.
- C5: the state must appear in the address the examiner read, or it is UNKNOWN. This is how "never
  inferred from the area code" is enforced in code, since the model's state field alone cannot show it.
  Accepted forms (R8, from real receipts): the code in capitals or title case ("TX", "Tx"), the
  full name, or a traditional abbreviation ("Calif", "Tex.", "N.J."). An all-lowercase code is not
  accepted, because "in", "or" and "me" are ordinary words in addresses.
- C2 ignores a product ID that is not in the settlement. C11 counts a line with no printed quantity
  as one unit.
- Check settings (`PROVISIONAL_CONFIG`: distance 4, tax margin 2 points, shingle 3, similarity 0.5,
  3 others, more than 5 claims in 24 hours) are provisional. The margin was chosen knowing receipts
  1084 and 1099. Later tuning uses the dev slice only.
- Lookups come in as arguments, and a failed one is passed as null, which gives UNKNOWN. R6 supplies
  them from Postgres.
- C7 and C9 are symmetric, not "earlier claims only", and are re-run across all claims before
  Distribute, so the first members of a cluster are held too.
- C8: a match with an approved claim → FAIL; with a claim still pending → UNKNOWN (REVIEW). Check
  and decide run one at a time per settlement (R6).

**Distribution (`packages/distribute`):**
- Reconciliation buckets are mutually exclusive: fund = paid + unclaimed + in flight + unverified +
  awaiting cy-près + cy-près sent + fees + held. Spec §1.3's equation double-counts money that
  returns and then goes to cy-près, and had no place for unverified items. `held` comes from the plan
  (reserve + fee reserve − fees), not "whatever is left", so a batch that differs from the plan shows
  as a difference. A fee PayPal has not reported is counted as unknown, never assumed.
- Allocation runs in BigInt: entitlement × fund can pass what a JavaScript number holds exactly.
- A share that rounds to zero stays listed and is left out of the batch: PayPal cannot send $0.00.
- Batch IDs derive from settlement and round. PayPal refuses a repeat only for 30 days, so R6's
  unique constraint is what refuses it for good.

**Database (migration 0004, `packages/db/src/queries/claims.ts`):**
- `decisions` and `check_results` are append-only for everyone, the table owner included; a person's
  decision or a cluster re-check is a new row, and the latest row is the current decision.
- The database itself refuses: a `sender_batch_id` used twice, a claim with a second live payout
  (only RETURNED or FAILED frees it), a payout of zero, an approval with no amount, findings on a
  reading that failed.
- `planBatch` writes the batch and items **before** the PayPal call, so a crash leaves a record to
  reconcile, never money nobody knows about.
- `withSettlementLock` runs check-and-decide one at a time per settlement (fix 6). A different
  settlement never waits.
- `claims.seq` is the filing order that "earlier" means in C6, C8 and C12.
- `fund_cents` and batch amounts are bigint; pg returns them as strings, and `toNumber` throws rather
  than round. 0004 grants `pushover_app` its own access: 0002 only covered tables that existed then.
- Claim IDs fit PayPal's `sender_item_id` (at most 63 characters of letters, digits, `.`, `_`, `-`).
- Claimant names, addresses, emails and evidence bytes are personal data: stored here, never in git,
  and masked in the public report (R10). Raw IPs are never stored, only a keyed hash of the network.

**Gate wording:** spec §5.4's "honest wrongly denied ≤ 10%" is the measured rate on the pilot slice,
not the Wilson upper bound. Wilson intervals are still reported (§5.3).

## The examiner (packages/examiner)

- Official `@anthropic-ai/sdk` 1.3.0. Image as a base64 block; structured output through
  `output_config.format` with `zodOutputFormat(FindingsSchema)`, called with `messages.create`, so a
  refusal or a bad reading is handled as a status and not an exception. Code runs `FindingsSchema`
  itself: the SDK moves constraints such as enums and integer ranges into descriptions, so the API
  does not enforce them.
- Every failure becomes a status and the table sends it to a person: refusal → REFUSED; early stop,
  bad JSON or a schema mismatch → INVALID; API error or budget stop → NOT_RUN. A bug in our own code
  still throws.
- **No refusal fallback.** Sonnet 5.5 offers a server-side one and Haiku 5.5 has none. A refusal goes
  to a person (spec §4.2), and a silent switch of model would corrupt the Haiku and Sonnet comparison.
- Effort is `medium` on both models, set explicitly, because their defaults differ.
- `CostGuard` stops before a call that could pass the budget, and counts refused calls too. The price
  table moved here from `packages/eval`, which re-exports it, because this package now spends.
- The model is passed in by the caller, who reads `PUSHOVER_MODEL` or `COMPARE_MODEL`. Findings `box`
  is a list of 4 numbers, because the SDK cannot express a fixed-length tuple.

## The eval (packages/eval, R8)

- `src/corpus/schema.ts` holds the claim set's formats; `src/oracle/` is the referee and may not
  import claims, checks, distribute or examiner (ESLint). The oracle restates decision table v1
  and the checks' rules in its own code, from each receipt's truth.
- `src/pipeline.ts` is arm C: findings, then checks, then the table, claim by claim in filing
  order, with C8's earlier claims marked APPROVED, PENDING or CLOSED by their decisions so far.
  The R9 runner feeds it real readings.
- C7 and C9 always see every claim in the set, even when only a slice is read, as in a real
  settlement where every claim is filed before clusters are checked.
- Rendered receipts and F4 copies are made into git-ignored `.data/claims-v1/` by
  `pnpm corpus:images`; F4 copies are made exactly as R4 measured the image hash.
- R9 runner: `pnpm eval:claims --run-id <id> --model <m> [--split pilot|holdout|dev|all] [--check]`.
  Arm B (`src/arm-b.ts`) gives the model the settlement's rules and one claim and asks it to
  approve or deny; a failed call is no decision and is not paid. Arm C's worst case lets the
  examiner's logged `model_recommendation` (or, for a no-proof claim, arm B's answer) decide every
  REVIEW. The slice's fund is the full fund scaled by its share of claims.
- Examiner model after the pilot (2026-11-01): Haiku 5.5 read all 24 pilot receipts exactly on
  date, state, subtotal, tax, total and drinks, as Sonnet 5.5 did, so Haiku stays the main model.


## Claimant identity: Log in with PayPal (owner decision 2026-11-02)

The perfect fake (a faultless receipt) passes every document check, so the money is tied to a
person instead: every claim is filed after Log in with PayPal, and the PayPal account is the
claimant's identity.
- One PayPal `payer_id` = one claim per settlement (userinfo returns it, see
  `docs/sandbox-findings.md`; it is not in the published schema, so a missing one fails closed).
- `verified_account` and a confirmed email are recorded on the claim; an unverified account goes
  to REVIEW, never straight to APPROVE.
- The access token is used once for userinfo and discarded: it carries the app's full scope list.
- Payouts go to that `payer_id` with `recipient_type: PAYPAL_ID` (sandbox: SUCCESS), not to an
  email, so the money reaches the account that filed. A bad ID fails only on read-back
  (`RECEIVER_ACCOUNT_INVALID`), so reconciliation must read every item.
- About 5% of approved proof claims are picked at random for audit before payout (R11).
- claims-v1 stays frozen; claims-v2 (R13) adds a perfect-fake group to measure what's left.

## Admin login and two-person money (owner decision 2026-11-10)

The admin screens show claimants' details and move money, so nothing there is anonymous.

- **Accounts** (`analysts`, migration 0006): role `analyst` or `supervisor`. Created only by
  `pnpm admin:add` (password from `NEW_ANALYST_PASSWORD`, never a web form). The judges' two
  sandbox logins come from `pnpm demo:analysts` (`JUDGE_ANALYST_PASSWORD`,
  `JUDGE_SUPERVISOR_PASSWORD`); they guard play money only, and the daily sandbox cap still applies.
- **Passwords:** scrypt from `node:crypto` (N = 2^17, r = 8, p = 1, 16-byte salt, 32-byte key),
  parameters stored with each hash. An unknown email is checked against a decoy hash, and gets the
  same answer as a wrong password.
- **Sessions:** a random 32-byte token in an httpOnly cookie (`poc_admin`, SameSite=Lax, Secure on
  HTTPS, 12 hours). Only its SHA-256 is stored, so a database leak opens no session. Logout deletes
  the row.
- **Throttling:** every login, failure and lockout is an audit-log row. Five failures for an email,
  or twenty from one network (a keyed /24 or /48 hash, never the raw IP), in 15 minutes lock it out.
- **Where it is checked:** every admin page, server action and admin API route calls
  `requireAnalyst()` / `currentAnalyst()` itself (`apps/web/lib/server/auth.ts`). A layout isn't
  enough: Next.js doesn't re-run layouts on every navigation, and server actions skip them.
  `test/admin-guard.test.ts` fails if a page reads data before the check or an action doesn't start
  with it.
- **Evidence photos:** served to a logged-in analyst, to the claimant who filed (their PayPal
  identity cookie), or to anyone for the labelled demo corpus (public dataset and our renders).
  `/demo/claim/[id]` shows labelled corpus claims read-only, so the demo needs no login.
- **Money needs two people** (plan item C7): an analyst *proposes* a round (the cluster re-check
  runs, the round is planned, and the exact plan is stored with its SHA-256). A *different* person
  with the *supervisor* role approves it: the re-check runs again, the round is planned again, and
  if the hash differs nothing is sent and the proposal is superseded. The database enforces the
  same rules: approver ≠ proposer, approver is an enabled supervisor, no approval after expiry (24
  hours), a decided proposal never changes, one open proposal per settlement and kind, and
  **no payout batch can be inserted without an approved proposal** of the same settlement and kind.
  The `distribute` audit row names both people.

## Claimant privacy (plan items P2, P4–P8; 2026-11-10)

- **No plain payer ID at rest** (migration 0007 drops the column and refuses to run if any plain
  value exists). Each PayPal-logged-in claim stores:
  - `paypal_pseudonym`: HMAC-SHA256 of the payer ID under a per-settlement key, itself
    HMAC-SHA256(`PAYER_PSEUDONYM_KEY`, `settlement:<id>`). It carries the one-claim-per-account
    unique index, and it is what the admin screens (first 10 hex), the payout record
    (`pseudonym:<hex>`, enforced by a check constraint) and stored money proposals show. The same
    account gets unrelated pseudonyms in two settlements, and nobody without the key can test a
    guessed payer ID.
  - `paypal_payer_sealed`: AES-256-GCM under `PAYER_SEAL_KEY` (version | 12-byte IV | tag |
    ciphertext), with `poc-payer-id:v1:<settlement>:<claim>` as associated data, so a sealed value
    copied to another claim won't open.
  - Only `packages/desk/src/payout.ts` opens it, to address the payment; the package doesn't export
    the function, and `test/identity-boundary.test.ts` fails on any other caller.
- **Keys:** both 32 random bytes, base64, from the environment. Required in production; without them
  in development, PayPal-logged-in claims can't be filed or paid (the error names the variable).
  The demo seed needs neither, because the corpus claimants never log in.
- **Private status link** (`/status/<token>`): 24 random bytes, base64url, returned once when the
  claim is filed; only its SHA-256 is stored. The page shows the claim's state, reason, checks and
  expected amount, and nothing personal (no name, address, email or PayPal details); it sets
  `noindex` and `Referrer-Policy: no-referrer`. A claimant who logs in with PayPal again (or presses
  "Show my claim's status" within the identity cookie's hour) gets a new link, and the old one stops
  working.
- **Unverified PayPal accounts** (P2): the claim is decided on its evidence like any other, but an
  approved claim from an unverified account is left out of every payout plan (counted on the money
  screen) until the claimant logs in again and PayPal reports the account verified. We keep no
  PayPal token, so a fresh login is the only way to re-read verification.
- **Every state in plain words** (P7) and **the expected amount** (P8): `apps/web/lib/claim-status.ts`,
  typed over the claim-state enum, so a new state can't ship without its wording.

## The money path after Distribute (R11; plan items P34, P36, P38–P40, C4, B5; 2026-11-10)

Facts behind these choices are in `docs/sandbox-findings.md` (2026-11-10).

- **Balance check (P34):** before a supervisor's approval sends anything, `GET /v1/reporting/balances`.
  The sandbox's balance was about two hours old, so everything we sent after its `as_of_time` (all
  settlements, plus $0.25 a payout) is subtracted first; short means refused, and the proposal stays
  open.
- **The plan's digest travels with the money (P36):** every payout item's `note` is
  `Proof of Claim <settlement> <kind> round <n>, plan sha256:<64 hex>`, and the batch email carries the
  first 16 hex. The hash is the one the second person approved (money proposals, migration 0006).
- **Read-back** stores each item's PayPal `transaction_id`, and walks the claim through every legal
  state to the one PayPal reports (a first read 30 days late can say RETURNED straight away).
- **PayPal's own history (P39):** the worker looks each payout up by `transaction_id` in Transaction
  Search. A window the history hasn't reached is `404 … not available`, recorded as WAITING; found is
  CONFIRMED with its code (`T0001 S`); still missing after 3 days is NEVER_CAUGHT_UP. Shown per item.
- **Webhooks (P38):** `POST /api/paypal/webhook` asks PayPal to verify every delivery
  (`verify-webhook-signature`, webhook ID `PAYPAL_GUARDED_WEBHOOK_ID`), stores each event once by its
  ID, and audit-logs refusals. A stored event only makes the worker read that batch back; its content
  never moves a claim. Needs the deployed URL: the owner creates the webhook after the first deploy.
- **Re-offer (C4):** a claim whose payment came back (RETURNED or FAILED) can be asked for again from
  the claimant's private link for `REOFFER_DAYS` (default 30), at most twice. It returns to approved
  and is paid in the next two-person round.
- **Cy-près (B5):** after the window, the worker moves the claim to CY_PRES_ELIGIBLE. An analyst
  proposes sending that money to the settlement's chosen nonprofit; a different supervisor approves
  (same hash and balance rules); one Payouts batch goes out. Each claim's money is recorded against the
  transfer that carried it (`cy_pres_claims`), so it goes once.
- **Where the money went (P40):** on the money screen. Each cent sits in one bucket: paid, unclaimed,
  in flight, unconfirmed, came back (re-offer window, then cy-près eligible), sent to cy-près, fees,
  held.
- **The worker** (`apps/worker`, `pnpm worker [--once]`): one at a time (Postgres advisory lock), every
  `WORKER_INTERVAL_SECONDS` (60): webhooks → read-backs, unsettled batches → read-backs (every 10
  minutes), up to 10 history lookups, re-offer expiry. It shares the sandbox request budget with the
  web app through `PgRateLimiter`. It never sends money.

## The decision ledger (plan items P33, P42–P45, C1, C2; 2026-11-10)

`packages/ledger` (pure TypeScript on `@noble/hashes` and `@noble/curves` 2.4.0, so the server and
the browser run the same code):

- **Leaves (C1):** one per decided claim, from its latest decision: claim ID, outcome, reason, rule,
  table version, rules-or-analyst, entitlement, SHA-256 of the evidence file, SHA-256 of the
  canonical findings, and the check results. No personal data. Canonical JSON (keys sorted).
- **Tree:** SHA-256, leaves prefixed 0x00 and inner nodes 0x01, leaves in claim-ID order, an odd
  node carried up unpaired. Inclusion proofs let one claimant check their own leaf.
- **Commitment:** version, settlement, kind, round, the approved plan's SHA-256, the root, leaf
  count, **the rules' fingerprint (C2)** (SHA-256 of `packages/claims/src/decision-v1.ts`, of
  `data/tax-rates.json`, and of the settlement's canonical configuration), and a **drand quicknet
  round** 30 seconds ahead (chain `52db9ba7…e971`, 3-second period, genesis 1692803367, scheme
  `bls-unchained-g1-rfc9380`, read from api.drand.sh on 2026-11-10). Its SHA-256 is the
  commitment digest.
- **When:** at the second person's approval, after the balance check and before any batch. The
  database refuses a payout batch without the commitment of its own proposal (migration 0009) and
  refuses any change to a commitment, except recording its beacon once.
- **PayPal's record names it:** each payout's note carries
  `ledger sha256:<digest>, drand quicknet round <n>, plan sha256:<hex>` (PayPal keeps notes as
  sent: batch `JX2JYNCASDVQG`); read-back stores the note.
- **Beacon and audit sample (P44):** the worker fetches the round from drand's relays once it's
  out, verifies the BLS signature against quicknet's key (and that the randomness is the
  signature's SHA-256), and records it with the sample: the 5 leaves with the lowest
  HMAC-SHA256(randomness, root ‖ leaf hash). Nobody could pick them: the root was fixed first.
- **Public ledger and "Verify in my browser" (P42, P43):** `/report/[s]/ledger` and
  `/api/ledger/[s]/[id]`. The browser recomputes the root and digest, checks PayPal's notes, checks
  the round was published after the commitment, fetches it from drand's relays (they send
  `Access-Control-Allow-Origin: *`), verifies it, and redraws the sample. Tested: a leaf changed in
  transit fails (e2e); a forged relay beacon is refused (desk test); the live run against drand
  passes (`LIVE_DRAND=1 pnpm e2e`).

## The console's sponsor tools: Bryntum timeline and AG Studio desk agent (plan items P24, C13; 2026-11-10)

- **Bryntum Scheduler** (`@bryntum/scheduler-react-enterprise` 8.0.0 from public npm, with
  `@bryntum/scheduler-enterprise` and `@bryntum/core-enterprise` at the same exact version, because pnpm
  only lets the app import packages it declares; the CSS comes from those two). It renders in the
  browser only (`next/dynamic`, `ssr: false`). The key is `BRYNTUM_LICENSE_KEY`, set on Bryntum's
  global in the client component (`globalThis.bryntum.licenseKey`); a Bryntum key is visible in the
  browser by design. A trial key still shows Bryntum's "Trial" badge (their licensing guide); the
  timeline's legend bar keeps the badge off the rows. Read-only: editing, menus and drag-create off.
- **AG Studio** 3.1.0 (`ag-studio`, `ag-studio-react`) needs AG Grid 36.3, so the claims grid moved
  from 36.2.0 to 36.3.0 with it (AG's compatibility table: standalone grids should match Studio's).
  The key is `AG_STUDIO_LICENSE_KEY`, passed to `AgStudioProvider` (it is visible in the browser too).
  The trial key's terms say evaluation only; production use needs a licence.
- **The desk agent is read-only (spec §4.7, rule 7).** Three places make it so:
  1. its data is the claims as decided, with no names, emails or PayPal identifiers
     (`/admin/[s]/ask` builds the rows);
  2. its tools are AG Studio's reading tools only (`view_schema`, `view_report`, `view_page`,
     `view_widget`, `execute_query`), and they run in the analyst's browser over that table;
  3. the server route `POST /api/admin/studio-ai` (analysts only, JSON only) forwards only those
     tool names to the model, whatever the browser sends (`READ_ONLY_TOOLS` in `lib/studio-llm.ts`,
     unit-tested).
  No tool reaches the desk, the database or PayPal, so the agent can't decide, hold or pay anything.
- **Adapter.** AG Studio ships no Anthropic adapter. `lib/studio-adapter.ts` sends each
  `AgLlmRequest` to the route; `lib/studio-llm.ts` translates it to the Messages API (parallel tool
  calls in one assistant turn, their results first in the next user turn, a call left without a
  result answered as "not run") and translates the reply back. The reply comes in one piece and is
  replayed to Studio as stream events. The model is `PUSHOVER_MODEL` (Haiku 5.5) with thinking off
  and effort `low`: Studio's conversation format has nowhere to carry thinking blocks between turns.
  Spend is capped per server process by `STUDIO_AI_BUDGET_USD` (default $0.50), and every turn is in
  the audit log (`desk_agent_turn`, with its cost). First live run, 2026-11-10: "denied claims over
  $20" took three turns (schema, one query, answer: 9 claims); "approve claim #1 and pay it" was
  declined in one turn. The four turns cost $0.0045 in total.

## Claimant upgrades: plain reasons, appeals, documents, languages, accessibility (plan items C3, P9, C9, B3, C11, C12; 2026-11-10)

- **After a decision (migration 0011, `claim_followups`, append-only).** Two things a claimant can send
  from their private status page (`POST /api/claims/followup?token=`):
  - *The document the rules asked for* (NEED_MORE, receipt claims, at most 3). The examiner reads it
    and the checks and decision table run again, exactly as at filing. The checks read the latest
    *requested* document (`checkedEvidence`); a photo sent with an appeal never feeds the checks.
  - *An appeal* (denied claims, claims with a person, claims in a held group; words required, a new
    photo optional; one open at a time, 3 in all). An appeal writes **no decision**: a denied claim's
    status moves DENY → REVIEW and the denial stays the decision on record (and in the ledger) until a
    person decides. The model and the rules never decide an appeal. It closes when an analyst decides
    the claim, or a group holding it, after it. The analyst's claim page shows the words and the photo
    ("From the claimant"); the review buttons and the review queue go by status, so an appealed
    denial is in the queue; the grid has an "Appealed" filter.
- **Plain-word reasons (C3)** come from `lib/plain-reasons.ts`: per failed check, a sentence filled
  only from the claimant's own receipt and the settlement's terms (date, period, store state, tax), and
  a fix that points at a form only if that form is on the page. The checks' internal details name
  other claims, so they are never shown to a claimant. A claim in a held group is shown as "held, with
  linked claims", never as simply approved.
- **Languages (C12).** The claim page, claim form and status page read from message tables
  (`lib/messages/en.ts`, `es.ts`, `hi.ts`); the type makes a missing key a compile error, and a test
  checks every `{slot}` matches English. The language comes from `?lang=`, then the `poc_lang`
  cookie, then Accept-Language. **The Spanish and Hindi were written for this demo and are not
  reviewed by a professional translator.** A real settlement must have its claim form, and above all
  the sworn declaration, translated and certified before use. Server-side rejections on the claim form
  itself are still English; the follow-up form's errors are codes shown in the claimant's language.
- **Accessibility (C11).** `@axe-core/playwright` runs the WCAG 2.0/2.1/2.2 A and AA rules in e2e on
  the claim page (English and Hindi), the status page with the appeal form, the landing, settlements,
  login and report pages at 390 px (nothing wider than the screen), and on the claims desk and a claim
  page. What it found and what changed: `--ink-3` was 2.8:1 (now 62% ink, at least 4.6:1 on every
  paper tone), `--review` amber 4.0:1 (now `#845b00`, at least 4.9:1), and the locked claim step faded
  its text (now only its number fades). Third-party widgets, audited separately: AG Studio's default
  send button was 3.1:1 (fixed by theming Studio with the app's tokens); Bryntum's grid still reports
  one `aria-required-children` rule inside its own markup, which the e2e suite doesn't cover.

## Assistants: MCP server, unbound claims, OpenAPI (plan items P11–P15, C14; 2026-11-10)

An assistant can do the paperwork, receipt included. Only the person can make it a claim, and only
a claim can be read, decided or paid.

**Research first (checked on the second machine, not from memory):**
- `@modelcontextprotocol/sdk` **1.32.2** is `latest` (published 2026-10-23). Its peer dependencies
  are `zod ^3.25 || ^4.0` and an optional `@cfworker/json-schema`. Read from the package itself:
  `McpServer.registerTool(name, { inputSchema, outputSchema, annotations }, cb)`, which takes a
  whole zod object; `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, …); and
  `WebStandardStreamableHTTPServerTransport`, which takes a web `Request` and returns a `Response`,
  exactly what a Next.js route handler has. With no `sessionIdGenerator` it is stateless. The SDK's
  own example builds a server per request, and in `enableJsonResponse` mode `handleRequest`
  resolves only once every reply is ready.
- The SDK publishes tool schemas labelled draft-07. Apart from that label, they are identical to
  zod's own 2020-12 output (measured; the drift test holds it).
- zod 4.6.7 has `z.toJSONSchema` built in, with JSON Schema 2020-12 as its default target. That
  is OpenAPI 3.1's dialect, so no converter library was added. `@asteasolutions/zod-to-openapi`
  9.1.0 and `zod-openapi` 6.0.2 (both peer `zod ^4.0.0`) were considered and not needed. Requests
  are generated with `io: "input"`; otherwise a field with a default (`units`) shows as required.

**Owner decisions (2026-11-10), the defaults proposed before building:**
- The MCP endpoint is open (no key) and rate-limited. The safety comes from what the tools can't
  do, not from a key.
- A receipt is stored and hashed at filing. The examiner reads it only after the person confirms,
  so an unconfirmed filing spends no AI credit.
- The confirm page is read-only, with a "this isn't mine" button that closes the filing.
- An unconfirmed filing lapses after 7 days, or at the filing deadline if that comes first.
- The e2e suite has no reader, so its confirmed receipt claim is decided REVIEW by rule 0.
- An assistant's name is shown as "the name it gave", never as verified.

**Unbound filings (migrations 0012, 0013; `packages/desk/src/assistants.ts`):**
- **New states.** UNBOUND (filed by an assistant, not confirmed) and LAPSED (never confirmed:
  timed out, or the person said it isn't theirs). They are in a migration of their own, because
  Postgres can't use an enum value in the transaction that adds it.
- **Nothing leaves UNBOUND except two ways:** SUBMITTED when its person confirms, or LAPSED.
- **The database holds the line on its own:**
  - an assistant's claim outside UNBOUND/LAPSED must have a confirmation time and a PayPal
    pseudonym;
  - a trigger refuses any payout item for an UNBOUND or LAPSED claim;
  - an assistant's claim is paid only to the PayPal account that confirmed it
    (`pseudonym:<hex>`), never to an email address.
  - Measured: a forced APPROVE decision on an unbound filing changes no plan. A planted bug that
    let the plan select it would have shrunk the leftover from $1,900.00 to $1,889.75, and the
    test caught it.
- **Confirming** (`confirmFiling`) needs the identity PayPal's login returned, in one transaction:
  - It seals the payer ID and sets the per-settlement pseudonym. One claim per PayPal account
    still holds, enforced by the same unique index.
  - It replaces the email with PayPal's.
  - It records the person's own network and device, not the assistant's servers. Otherwise every
    claim filed through one assistant would look like a C9 velocity cluster.
  - It moves the claim to the **end of the filing order** (a new `seq`, `submitted_at` = now). So
    "earlier" in C6, C8 and C12 means earlier to be confirmed, and claims decided while it waited
    are compared with it.
  - Then the same `readEvidence` and `decideClaim` run as for the form.
  - The person gets a fresh status link, and the assistant's link stops working: the claim is the
    person's now.
- **Unconfirmed filings are not claims.** They are left out of:
  - C6, C7, C8, C9 and C12, and the ring detector, so a bot can't file a stranger's receipt or a
    thousand look-alikes to make honest claims look like copies or a cluster;
  - the court report, the totals, the scoreboard, the groups, the desk agent's rows and the
    settlements counts (`claimViews` leaves them out unless asked).

  Only the analysts' grid shows them.
- **What an assistant sends.** No `sworn` field: an assistant can't swear for anyone, so the person
  swears on the confirm page. No email: PayPal's replaces it. The worker lapses old filings
  (`lapseUnconfirmed`).

**The MCP server (`apps/web/lib/mcp/server.ts`, `POST|GET|DELETE /api/mcp`):**
- Three tools: `list_settlements` (read-only), `file_claim` and `claim_status` (read-only). Each
  carries annotations, and the server sends instructions saying the person must confirm with
  PayPal.
- Stateless: a fresh server and transport per request, JSON responses.
- Both the MCP route and `/api/v1` call one service, `lib/server/assistant-api.ts`, so they can
  only differ in transport.
- **No tool can confirm, decide, approve or pay**, held three ways:
  1. `tools.test.ts` lists the tools through the SDK's own client, in memory and over HTTP. It
     fails on a fourth tool, or on any tool or input field named for confirming, deciding or
     paying. Both planted bugs failed it.
  2. ESLint forbids the assistant code from importing PayPal code, the PayPal login (which mints
     a claimant's identity), analyst sign-in, or the desk's and database's deciding and paying
     functions. `test/import-boundaries.test.ts` checks the rule and lints the real files.
  3. The database (above).
- **Rate limits** (`LIMITS` in `lib/api/schemas.ts`, published in the OpenAPI document):
  - per network (a keyed hash, never the raw IP): 60 calls and 10 filings a minute;
  - per settlement: 300 assistant filings an hour.

  `PgRateLimiter.allow()` refuses at once with a retry time, where `take()` waits.

**JSON API and OpenAPI 3.1 (P15):**
- `GET /api/v1/settlements`, `POST /api/v1/claims` and `POST /api/v1/claims/status` (the token
  goes in the body, so it stays out of URLs) are the JSON twins of the three tools.
- `docs/openapi.json`, and the same document at `GET /api/openapi.json`, is generated from
  `lib/api/schemas.ts` (`pnpm openapi`). The claim form's schema lives there too.
- The drift test (`lib/api/openapi.test.ts`) fails:
  - if the schemas change and the file isn't regenerated;
  - if any tool's input or output schema differs from its operation's by more than the dialect
    label;
  - if the form and the assistants stop checking a shared field the same way.

  Planted drifts failed it.

**The confirm page (`/confirm/<token>`, `POST /api/claims/confirm`):**
- It shows what was filed in the person's name and by which assistant, stamped "Waiting" in review
  ink (never green).
- Log in with PayPal carries the confirm token through the round trip, in the state cookie, and
  comes back to the page.
- The person ticks the sworn declaration and confirms, or closes the filing.
- The identity cookie is `SameSite=Lax`, so another site can't post a confirmation with it. Closing
  needs only the link, and it moves no money.
- In English, Spanish and Hindi. The Spanish and Hindi are not reviewed by a professional
  translator.

**Filed by (P11, P14):**
- The grid has a "Filed by" column (in CSV too) and the filters "Filed by an assistant" and
  "Waiting for its person". The analyst's claim page and the claimant's status page say who filed
  it, and the court report has `filed_by`.
- Every label reads "gave its name as", because the name is self-declared.

**Limits:**
- Live Log in with PayPal still waits for the deployed callback URL (P1); the confirm flow is
  tested with a sealed identity cookie, as the claim form is.
- An 8 MB photo is about 11 MB of JSON; only small photos were sent through the routes in tests.
- `PUBLIC_ORIGIN` (optional) sets the links handed to assistants when the app sits behind a proxy.

## PayPal's Server SDK and the APIMatic Context Plugin (plan items P57, C5 research; 2026-11-11)

**What moved.** `@paypal/paypal-server-sdk` 2.5.0 is PayPal's TypeScript SDK, generated by APIMatic
(npm, published 2026-08-21; source `github.com/paypal/PayPal-TypeScript-Server-SDK`, tag `2.5.0`). Its
controllers are OAuthAuthorization, Orders, Payments, Subscriptions, TransactionSearch and Vault: no
Payouts, no webhook verification, no identity userinfo. So the two reporting calls moved to it and the
rest stays on the hand-written client (`packages/paypal/src/client.ts`):
- `getBalance` → `TransactionSearchController.searchBalances` (the balance check before a Distribute, P34);
- `findInHistory` → `TransactionSearchController.searchTransactions` (the history check after it, P39).

Their signatures didn't change, so the desk and the worker didn't either. `PayPalClient.sdk` builds one
SDK client from the same credentials, limiter and timeouts on first use and keeps it
(`packages/paypal/src/sdk.ts`); `PayPalSdk.call` turns the SDK's errors into this package's
`PayPalApiError` / `PayPalNetworkError`, so callers see the same errors as before.

**How the APIMatic Context Plugin was used.** The owner installed the plugin
(`paypal@context-plugins-local` 0.1.0, from `github.com/paypaldev/server-sdk-context-plugin-preview`) on
2026-11-10. Its TypeScript skills were loaded in the order the plugin gives, each before writing that
part, and each claim was checked in the SDK's source under `node_modules`:

| Skill | What it decided here |
|---|---|
| `typescript-getting-started` | Pin the exact version (2.5.0); read the installed SDK's `src/`; import from the package root |
| `typescript-client-initialization` | One `Client`, built once and reused; `Environment.Sandbox`; controllers constructed per call |
| `typescript-authentication` | `clientCredentialsAuthCredentials`; `oAuthClockSkew` 300 s; a token provider that **never rejects** (see below) |
| `typescript-calling-endpoints` | Both operations take one options object; the payload is on `.result` |
| `typescript-models` | camelCase members (`asOfTime`, `transactionDetails`), `Money` as strings; responses are checked against PayPal's schema |
| `typescript-error-handling` | `ApiError` with `statusCode`, `result` (typed errors) or `body` (bare ones), mapped to our error types at one boundary |
| `typescript-configuration-resilience` | The SDK's timeout default is 0 (no timeout): set 15 s. Retries default to none: GET retries with a wait budget. No free-form base URL: a request interceptor for the e2e stand-in, plus the token manager rebuilt so token requests are redirected too |
| `typescript-testing` | `unstable_httpClientOptions.adapter` as the test seam, bridged to the existing fake fetch, so the old tests keep their fake PayPal; a test that the token request reaches the stand-in |

**Found in the source, beyond the guides.**
- A failed token fetch is cached even without a custom provider: `@apimatic/oauth-adapters` keeps the
  refresh promise as the client's token, so one network blip on the token call would fail every later call
  until a restart. Our provider returns an expired token on failure instead, so the next call fetches again
  (test: a 401 on the token, then success).
- With `retryOnTimeout` on, `@apimatic/core` 0.10.30 retries every error thrown inside its retry step,
  including PayPal answers the operation maps to a typed error (balances: 400, 403, 500). A 403 was sent
  four times. It's off: retries happen by status (408, 429, 500, 502, 503, 504) on GET only, and a network
  failure is not retried here (the money page can be asked again; the worker runs again).
- The SDK writes empty `&` segments for unset query parameters; the sandbox accepts them.

**Sandbox only.** `standInFor` refuses any base URL but the sandbox or `http://127.0.0.1` / `localhost`
(the e2e fake), so this client can't reach production (a first part of P53, for the SDK path only).

**Evidence.** `packages/paypal/sandbox/reporting.sandbox.ts` (reads only, run on demand): the fund's
balance through the SDK ($6,340.90 as of 2026-11-11 02:59:59Z) and payout `4LF69280FT181700C` found as
T0001, status S, −$1.00, fee −$0.25. Unit tests: 9 new in `packages/paypal/test/sdk.test.ts`; the e2e
money test sends a Distribute through the web app with the SDK's balance check against the fake PayPal.

**C5 research (Part D item 11: purchase proof from the merchant's own records), as of 2026-11-11.**
- The spec (`reporting_transactions_v1.json`): `payer_info.account_id` is "the PayPal customer account ID";
  `cart_info.item_details` has `item_code`, `item_name`, `item_quantity` and amounts.
- Sandbox, last 31 days, `fields=all` (`packages/paypal/scripts/probe-purchases.ts`): the guarded and baseline
  merchants hold 23 and 313 card purchases (T0005). Items come back. But every card purchase carries the
  **same** payer account ID (`5AC7…`, payer status N): a guest card payment doesn't identify a person, so a
  card purchase can't show who bought.
- A purchase paid with a PayPal account (`packages/paypal/scripts/sandbox-purchase.ts`): buyer1 bought
  "Lemonade, 16 oz" (SKU `DRINK-LEMONADE-16`, $4.50) from the baseline merchant. The order was created and
  captured through the SDK's `OrdersController` and approved in a headless browser logged in as buyer1
  (order `6NE45228XM135812U`, capture `7L289335836229053`, COMPLETED). The capture's `payer.payer_id` is
  **the same** as the `payer_id` Log in with PayPal returned for buyer1 on 2026-11-02.
- Still open: whether the merchant's Transaction Search shows that purchase with buyer1's payer ID and the
  SKU. PayPal says history can take up to three hours; at 04:52Z it was last refreshed at 02:59:59Z.
- Limits, from the SDK's own operation notes and the spec: Transaction Search reaches back three years,
  31 days per request, and has no payer filter, so a merchant's history has to be paged through and
  indexed, not searched per claim. C5 fits a merchant's own recent refund or recall program; it can't
  cover the demo settlement's 2015–2019 class period.
