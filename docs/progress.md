# Progress (hand-off between machines and sessions)

Last updated: 2026-11-12 (original laptop, Phase 11).

## The project: Proof of Claim (pivot from Pushover, 2026-10-31)

Renamed to **Proof of Claim** on 2026-11-10 (owner decision; package scope `@proofofclaim/*`). Commits
before that date use the working name.

Pushover stopped at its pre-registered NO-GO: 0 of 33 attacks leaked on both Haiku 5.5 and
Sonnet 5.5 (`docs/research-findings.md`, `docs/methodology.md`). This repo now builds
**Proof of Claim** per the build spec outside the repo (CLAUDE.md names it; build order §6, steps R0–R14):
a claims desk for class-action settlements. The AI reports findings about claim evidence,
deterministic code decides and computes amounts, and PayPal Payouts pays approved claimants,
with unclaimed money going to the court's chosen nonprofit (cy-près).

Reused from Pushover: `packages/paypal`, `packages/db` (migrator, pool, `PgRateLimiter`,
append-only audit log), the pre-registered eval method and `packages/eval/src/cost.ts`.

Owner decisions (2026-11-01):
- Commit as we go; ask before every push.
- Pushover's agent code is retired by tag + delete: tag `pushover-final` marks the last
  Pushover commit.
- Package scope was `@pushover/*`; renamed to `@proofofclaim/*` in one commit on 2026-11-10.
- Admin screens are built on **AG Grid** (sponsor prize target, spec §4.7). The **AG Studio**
  trial starts **on or after Nov 3**, never before.
- Models unchanged: main `claude-haiku-5-5`, comparison `claude-sonnet-5-5`; the examiner
  pilot (spec §5.4) may move receipts to Sonnet (`docs/architecture.md`).

Dates (IST): R0–R7 by Nov 3; a minimal version (/demo plus one real Payouts batch) submitted
by Nov 5 for the early eligibility check; everything by Nov 12, 23:59.

## Owner decisions 2026-11-09/10 (these win over the spec where they conflict)

- This is the owner's only entry; both people work on it, one laptop at a time, with this file
  as the hand-off.
- Renamed to Proof of Claim (`a3cd62f`). Never name a rival entry in anything public (app,
  README, video, Devpost, this repo), and never present one-claim-per-PayPal-account as our idea.
- **Build order from now on: `../FULL-BUILD-PLAN.md` Part E, in strict phase order** (owner's
  choice on 2026-11-10, knowing deploy and submission come last and the deadline is
  Nov 13 01:30 IST). Mark plan items (P/B/C) below as they land.
- Money needs two people (plan C7): an analyst proposes, a different supervisor approves.
- C6 duplicate-image false positive (c-115): keep decision table v1; report it in R13 and
  LIMITATIONS.md.
- No green "safe" state anywhere in the UI (unknown shows as UNVERIFIED or HELD): Phase 12.
- Pushed 2026-11-10: the 11 R10 commits (`adad2db..78d087b`). Ask before every push.
- **C5 (purchase proof from the merchant's PayPal records): recorded, not built** (owner, 2026-11-11). Its
  research is in `docs/architecture.md` (last section); Phase 11 comes next.

## FULL-BUILD-PLAN phases

| Phase | Status |
|---|---|
| 0 Housekeeping: push R10, rename | done (`a3cd62f`) |
| 1 Admin login and roles (P16, C7) | done (`1db104e`, `976a508`) |
| 2 Finish R10: e2e, live login, first Distribute from the app | done except the live Log in with PayPal, which needs the deployed URL (below) |
| 3 Identity and privacy (P2, P4–P8) | done (`1dab995`, `0023e45`) |
| 4 Money path: the R11 worker (P34, P36, P38–P40, C4, B5) | done (`bb4c15c`..`e8ef04d`); webhook registration waits for the deployed URL |
| 5 The decision ledger (P33, P42–P45, C1, C2) | done (`ad497ea`, `7bdeeee`, `5b7d484`) |
| 6 Rings and the AI investigator (P25–P32, C8) | done (`e125701`..`270e259`) |
| 7 The console (P17–P24, C6, C13) | done (`3fc0cec`..`f1d26ae`) |
| 8 Claimant upgrades (P9, C9, C3, B3, C11, C12) | done (`4f6f196`, `f3430d8`, `a03e4e1`) |
| 9 Assistants: MCP server and OpenAPI (P11–P15, C14) | done (`c442fec`..`2700ac9`) |
| 10 APIMatic: PayPal's Server SDK (P57), purchase proof research (C5) | done: P57 (`c2569ab`); C5 researched and recorded, not built (owner, 2026-11-11) |
| 11 deploy (R12): Railway web, worker, Postgres (P51), eval gate (P52), sandbox-only guard (P53) | live at https://web-production-3f92e595.up.railway.app (2026-11-12); done: Return URL and webhook set, live Log in with PayPal works, owner logged in from a phone (`docs/deploy.md`) |
| 12 judges and demo | done except P47 private copies (not built); `/judge`, `/demo/scale`, landing reposition, real round `UN6TR3QNHZV4C` |
| 13 full eval (R13) and the real sandbox distribution | done: held-out GO on Haiku and Sonnet (`docs/methodology.md`), round 2 `YPBRD2TBA4Y9A` sent and read back |
| 14 submission (R14) | written: README.md, LIMITATIONS.md (P50), AI_ASSISTANCE.md, `docs/video-script.md`, `docs/devpost.md`; owner records the video and submits |

Plan items landed: **P16** admin login (real accounts, roles, every action names the person),
**C7** two-person approval (enforced in code and in the database), P35/P37 (already had),
**P2** unverified accounts wait, **P4** sealed payer ID, **P5** per-settlement pseudonyms, **P6** private
status link, **P7** every state in plain words, **P8** expected amount, **P34** balance check, **P36** plan
digest on every payout (verified in the sandbox), **P38** verified webhooks (code; registration after deploy),
**P39** PayPal history check, **P40** where the money went, **C4** re-offer, **B5** cy-près with two people,
**P33** ledger committed before paying with a drand round, **C1** decision leaves, **C2** rules by hash,
**P42** public ledger page, **P43** verify in the browser, **P44** audit sample, **P45** one shared package,
**P25** signals and strong-core groups, **P26** group pages, **P27**/**P28** investigator with stand-in labels,
**P29** rejected-answer banner, **P30** replay, **P31**/**C8** measured false holds, **P32** 5,000-claim generator
(synthetic people only: no receipts at that scale; receipt fraud stays measured on claims-v1),
**P17** settlements index, **P18** create form (supervisors), **P19** filing deadline and decide-after-close,
**P20** grid CSV export and linked-group column, **P21**/**C6** live scoreboard with lone fakes, **P22** group
decisions one by one or in bulk, **P23** no money while a group is held, **P24** Bryntum timeline, **C13**
read-only AG Studio agent, **P9**/**C9** appeal with a new photo, **C3** reasons in plain words, **B3** the
requested-document upload, **C11** axe accessibility checks, **C12** Spanish and Hindi claimant pages,
**P12** MCP server (three tools, none can confirm, decide or pay), **P13** unbound until the person confirms with PayPal,
**P14** the assistant's name on the claim and in the grid, **P11** "Filed by", **P15** OpenAPI 3.1 with the drift test,
**C14** assistants send the receipt and it is checked like any claim.

- **Phase 1 evidence (2026-11-10):** migration 0006 (analysts, sessions as token hashes, money
  proposals; database guards: no self-approval, supervisor only, no approval after expiry, no
  payout batch without an approved proposal). scrypt passwords; lockout after 5 failures per email
  or 20 per network in 15 min, from the audit log. `test/admin-guard.test.ts` fails if an admin
  page reads data before `requireAnalyst` or an action doesn't start with it. Planted bugs (no
  plan-hash check, no lockout, any analyst may approve, data read before the guard, an unguarded
  action) each failed tests. Anonymous HTTP: all admin pages 307 to `/login?next=…`.
- **Phase 2 evidence (2026-11-10):** `pnpm e2e` 6/6 on a production build with its own database
  and a fake PayPal (happy path, deny, review, someone else's result is 404, anonymous redirects,
  propose → supervisor approves → read back, paid to the PayPal account). CI runs it as a job.
  The first e2e run found that the re-check before money undid analysts' approvals (fixed,
  `88cb2c7`). First real Distribute from the app: sandbox batch `2HMAKHX862SAE`, 27 items, all
  UNCLAIMED, fees $6.75, reconciled (`docs/sandbox-findings.md`); it showed the daily cap
  shrinking everyone's share (fixed, `3c21938`). `pnpm test` 753/753 in 25 files.
- **Phase 3 evidence (2026-11-10):** migration 0007 (no plain payer ID; pseudonym index; sealed
  ID; status-token hash; payout items to PayPal accounts must record a pseudonym). 14 new desk tests
  (seal/open, wrong claim or key or flipped byte refused, pseudonyms differ per settlement, unverified
  waits then pays, links rotate), 5 new db tests, 19 web unit tests (every state has wording),
  `test/identity-boundary.test.ts`. Planted: a web file opening a sealed ID, and paying unverified
  accounts; both failed tests. e2e 8/8; the e2e database holds no plain payer ID anywhere (checked
  directly). `pnpm test` 787/787 in 28 files. GitHub CI green, including the e2e job.
- **Phase 4 evidence (2026-11-10):** research first (`scripts/money/probe-reporting.ts`: balance two
  hours stale, history 404 "not available" for today, T0001 S/P once caught up, the payout webhook
  events). Migration 0008. 7 PayPal client tests on recorded shapes; 9 new desk tests (balance refused
  and the exact subtraction, digest on every item, transaction IDs and the re-offer clock, history
  states, re-offer once in the window, expiry, cy-près once by two people, webhook replay and unknown
  batch). Planted: no subtraction, cy-près forgetting its claims; both failed tests. Found and fixed:
  a first read-back of RETURNED left the claim stuck at SCHEDULED. Live: one worker pass read
  `2HMAKHX862SAE` back and recorded 10 payouts as waiting for history; sandbox batch `JX2JYNCASDVQG`
  kept the plan-digest note. `pnpm test` 803/803 in 29 files; e2e 8/8.
- **Phase 5 evidence (2026-11-10):** research first (drand chains, quicknet info and relays read from
  api.drand.sh; relays send `Access-Control-Allow-Origin: *`; `npm view` of `@noble/curves` 2.4.0).
  `packages/ledger` 15 tests (a real quicknet beacon verifies; a 300-run proof property test).
  Migration 0009 (+2 db tests: batch needs its proposal's commitment; a commitment is frozen, its
  beacon recorded once). 3 desk tests (committed before every batch and covering every decision;
  no rules fingerprint, no money; forged beacon refused, real one recorded with its sample).
  Planted: trust the relay; a sample the randomness doesn't drive; both failed. e2e 10/10 (public
  verify passes; a ledger changed in transit fails) and the live drand run passed. `pnpm test`
  820/820 in 31 files. CI green again after `65668a6` (fixed a test type error that `652c857` pushed).
- **Phase 6 evidence (2026-11-10):** `packages/checks/src/rings.ts` (15 tests incl. a property test
  that networks and buildings alone never group, and the chain test); investigator in
  `packages/examiner/src/investigate.ts` (20 tests); migration 0010; desk tests incl. a prompt scan for
  personal data (a planted claim-ID leak failed it). Live investigator runs on the demo's groups
  recorded honestly in `docs/methodology.md` (it wrongly recommended clearing fraud groups in the first
  two designs). Measured on the held-out rings-v2 (pre-registered `60d27eb`): recall 80.0%, false holds
  6.3% (households 27.6%), precision 84.9%; the rings-v1 result (38.7% false holds) is kept with its
  two causes. `pnpm demo:rings` records answers in `data/replay/investigations.json`.
- **Phase 7 evidence (2026-11-10):** P23 desk tests (proposal and approval refused while a group is
  held); group decisions recorded per claim by the deciding analyst; settlements index and create form
  (e2e files a claim into a settlement made from the form); filing deadline refuses late claims and the
  worker decides after close; scoreboard arithmetic is a pure function with 8 tests (demo: pay everyone
  $770 to fraud, the rules $40, the rules with people's decisions $30; 17 lone fakes, 14 stopped by the
  proof checks); Bryntum timeline renders the held groups in a browser (trial key accepted, its "Trial"
  badge shows by design); AG Studio agent: AG Studio's reading tools only, enforced on the server
  (`READ_ONLY_TOOLS`, 7 translator tests); live run: "denied over $20" in 3 turns (9 claims), "approve
  claim #1 and pay it" declined; 4 turns cost $0.0045. AG Grid moved to 36.3.0 to match AG Studio 3.1.
- **Phase 8 evidence (2026-11-10):** migration 0011 (append-only follow-ups); desk tests: a requested
  document is read and re-decided (and a copied photo is caught by C6), an appeal moves DENY to REVIEW
  with the denial still on record and closes when a person decides, appeal photos never feed the checks,
  follow-ups can't be edited. Web: plain-word reasons from the claimant's own receipt (6 tests),
  message tables in en/es/hi with a test that keys and slots match (Spanish and Hindi not yet reviewed by
  a professional translator). e2e: appeal end to end with the analyst's decision, filing in Spanish
  with the reason in Spanish, axe WCAG A/AA on claimant pages at 390 px (en and hi) and on the desk.
  Fixed for axe: text contrast tokens, the review amber, the locked claim step, AG Studio's send button.
  Not covered: Bryntum's grid reports one `aria-required-children` rule inside its own markup.
  Checks at the end of Phase 8: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 905/905 in 37 files,
  `pnpm e2e` 16 passed, 1 skipped (the live drand test, run with `LIVE_DRAND=1`).
- **Phase 9 evidence (2026-11-10, second machine):** research first: `@modelcontextprotocol/sdk` 1.32.2 read from
  the package (web-standard Streamable HTTP transport, `registerTool` with zod objects and annotations); zod 4.6.7's own
  `toJSONSchema` is 2020-12, OpenAPI 3.1's dialect, so no converter library. Migrations 0012 (UNBOUND, LAPSED) and 0013
  (who filed, the confirm token's hash, database guards). 14 desk tests on Postgres: an unbound filing is in no Distribute
  or cy-près plan even with an approval forced into its record (the plans are equal to the field), the database refuses
  to approve it or plan a payout for it, an assistant's claim is paid only to the confirming PayPal account, confirm binds
  once and moves the claim to the end of the filing order, one claim per PayPal account holds, unconfirmed filings don't
  feed C6/C7/C9, lapse after 7 days, "not mine" closes. MCP: 8 tests through the SDK's own client (in memory and over
  HTTP), 28 new import-boundary tests. OpenAPI drift test (5). Filed-by wording (4), limiter `allow()` (1). Planted bugs,
  each failed its test: no exclusion in the check lookups; the plan selecting UNBOUND (leftover $1,900.00 → $1,889.75);
  a fourth tool `approve_claim`; a `confirmed_by_person` field; a schema changed without regenerating `docs/openapi.json`;
  an MCP tool drifting from its operation. e2e (new `assistants.spec.ts`, 8 tests): a real MCP client files a receipt
  claim over HTTP, it waits UNBOUND on the desk and is not in the report, confirming without a PayPal login is refused,
  the person confirms under oath and the table decides (REVIEW: e2e has no reader), the assistant's token stops, an
  out-of-class confirmed claim is denied, "not mine" closes it, the confirm page passes axe at 390 px (en, hi).
  **Live test before pushing** (production build on a fresh database, real `.env.local`):
  - Raw MCP over curl: initialize, tools/list (3 tools with annotations), unknown tool refused, protocol errors 406/400.
  - JSON API: 20 cases (415, bad JSON, every field rule, unknown settlement, proof without receipt, non-base64, non-image,
    9.05 MB refused, 6.48 MB accepted, rate limit 10/min per network then 429 with Retry-After, another network unaffected).
  - **Real reader:** an MCP client filed rendered receipt r-001 (Michigan 2017, two drinks); the person confirmed with a
    PayPal identity; Haiku 5.5 read it and the rules approved 2 drinks for $30.00 with all 12 checks passing (6.8 s;
    under $0.01). The money page then planned 1 payee to the PayPal account and counted none of the 16 unconfirmed filings.
  - The worker lapsed a backdated filing (`"lapsed":1`, audit row). By hand in SQL, the database refused: an unconfirmed
    filing to APPROVE, a payout for it, a payout of a confirmed assistant claim to an email, binding without PayPal.
  - Found and fixed (`76cec7d`, `2700ac9`): an unknown field like `sworn` was silently ignored (now refused); GET/DELETE
    on `/api/mcp` opened an empty stream (now 405); the grid said "all pass" on unchecked filings; the stamp overlapped
    the label on desktop; the confirm page said "your receipt is read" on no-receipt filings.
  Checks at the end of Phase 9: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 990/990 in 42 files, `pnpm e2e` 24 passed,
  1 skipped (live drand).
- **Phase 10 evidence (2026-11-11, original laptop):** balances and Transaction Search now go through
  `@paypal/paypal-server-sdk` 2.5.0 (APIMatic-generated), set up from the APIMatic Context Plugin's
  TypeScript skills (which skill decided what: `docs/architecture.md`, last section). Sandbox, through the
  SDK: balance $6,340.90; payout `4LF69280FT181700C` found as T0001 with its $0.25 fee; an unknown ID is
  NOT_IN_HISTORY (`packages/paypal/sandbox/reporting.sandbox.ts`, 3/3). Two runtime traps found in the
  source and handled: a failed token fetch stays cached (provider that never rejects, tested), and
  `retryOnTimeout` re-sent a 403 three times (off, tested). The SDK refuses any base URL but the sandbox
  or a local stand-in. C5 research: card purchases all carry one shared payer ID, so they can't show who
  bought; a PayPal-account purchase by buyer1 (order `6NE45228XM135812U`) captured with the same payer ID
  as buyer1's Log in with PayPal; whether the merchant's history shows it is not settled: checked every 10
  minutes for 4 hours, never found, but both merchants' sandbox history stayed "last refreshed 03:29:59Z"
  the whole time (captured 04:52Z). The owner chose to record C5 and not build it. Checks: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 999/999 in 43 files, `pnpm e2e` 24
  passed, 1 skipped.
- **Live Log in with PayPal (P1) waits for the deployed URL:** PayPal's authorize page answers
  `invalid_redirect_uri` for `http://localhost:3100/api/paypal/callback` (checked 2026-11-10,
  `docs/sandbox-findings.md`). After the first deploy the owner adds
  `https://<deployed>/api/paypal/callback` as a Return URL on `pushover-guarded`.

## Spec R-steps (build spec §6), for reference


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
| R10 `apps/web` (AG Grid admin) | done 2026-11-10 except the live PayPal login (needs the deployed URL) |
| R11–R14 Worker, deploy, full run, submission | |

- **R1 evidence (2026-11-01):** tag `pushover-final` → `b613415`. `pnpm lint` exit 0,
  `pnpm typecheck` exit 0, `pnpm test` 75/75 in 7 files (15 import-boundary tests for the
  examiner and oracle bans). The lockfile no longer contains `@paypal/agent-toolkit`.

## Hand-back to the other laptop (2026-11-10, after Phase 9; taken back 2026-11-11)

- **Next: Phase 10, APIMatic, on the other laptop.** Its input is `docs/openapi.json` (OpenAPI 3.1, regenerated with
  `pnpm openapi`; the drift test fails if it falls behind the schemas in `apps/web/lib/api/schemas.ts`). The three
  operations are `listSettlements`, `fileClaim` and `claimStatus`; the MCP endpoint is `/api/mcp`.
- **Migrate the demo database to 0013** (`pnpm db:migrate`) before running the web app on it.
- **New optional env:** `PUBLIC_ORIGIN` (the deployed origin, for the confirm and status links handed to assistants).
- **After the first deploy (Phase 11):** the confirm page uses the same Log in with PayPal as the claim form, so the
  one Return URL (`https://<deployed>/api/paypal/callback`) covers both.
- **This laptop's setup, for the record:** `.env.local` at the repo root (copied from the older `.env` one folder up,
  with `SESSION_SECRET`, `NETWORK_SECRET`, both payer keys and both judge passwords generated here, and
  `DATABASE_URL` pointing at this laptop's `pushover-pg` container, database `proofofclaim`); `core.hooksPath` set
  to `.githooks`; Playwright Chromium installed. The demo database here is migrated but not seeded.
- Not done in Phase 9, optional: a line on the claim page telling people an assistant can file for them. (The live
  run of an assistant-filed receipt through the real reader was done: Phase 9 evidence above.)

## In progress

- **Phase 11 (2026-11-12):** deployed; `docs/deploy.md` has the services, how to deploy (`scripts/deploy.sh`:
  committed code, checks, eval gate, `railway up`), secrets by name, how the demo data was loaded, and the
  checks run on the live site. The owner added the Return URL and the webhook (`8P575864EG572884E`, set
  on web and worker); live Log in with PayPal works as buyer1 after the redirect fix (`37424d5`). The owner
  opened it on a phone and logged in with PayPal as buyer1: it worked. Phase 11 is done.
  Next: Phase 12 (judges and demo).
- **Phase 13 (2026-11-12): done.** Held-out claims-v1 (100 claims), pre-registered gate GO on both models:
  Haiku fraud paid $40 of $1,620 (worst case $245), honest denied 3/41, workload 8/41, 86/100 as expected,
  $0.13; Sonnet $40, 2/41, 7/41, 87/100, $1.50 (owner approved the spend; credit was about $10). Misses and
  fairness by kind in `docs/methodology.md`. Real distribution (§5.5) on the live demo: round 2
  `YPBRD2TBA4Y9A`, 24 payments $455, Dana Reyes's $10 SUCCESS to her PayPal account, 23 UNCLAIMED; cap raised
  to $1,000 for that round and set back to $50. The landing page now shows the held-out run; the scroll story
  keeps the 32 pilot claims.
- **Phase 12 (2026-11-12): done except P47.** `/judge` (P46: logins, eight steps, status read from the server's
  configuration; P49: the newest real payout's trail from claim to PayPal batch, item and history to the ledger);
  no green for passed checks, all-pass or verified accounts; labels wrap on phones; the batch-ID collision
  found and fixed (`0ba1820`, migration 0014); the app moved to database `proofofclaim_v2` and a real round sent
  (`UN6TR3QNHZV4C`, 3 items UNCLAIMED as the labelled set's addresses are fictional; `docs/deploy.md`); landing
  hero leads with the proof (P48: tax caught, model said approve and the rule said no 9 times, cy-près, the
  pre-registered number, each from the committed pilot run, linked); `/demo/scale` (P41: 120,000 simulated
  claimants through the real allocation and batching code, marked "Simulated, never sent to PayPal", beside the
  real sandbox rounds). **P47 (private demo copy per visitor): not built** (time; cloning 57 claims with their
  evidence and a shared money cap). `/judge` says the demo is shared. Checks: lint 0, typecheck 0, `pnpm test`
  1004/1004, `pnpm e2e` 26 passed, 1 skipped; eval gate PASS on every deploy.
- Phase 10 is done: P57 built, C5 recorded and not built. One C5 fact is still unknown: whether the merchant's
  history shows the test purchase with buyer1's payer ID and the item. The sandbox history stopped refreshing
  at 03:29:59Z on 2026-11-11 and hadn't moved by 09:08Z; re-check once it does (command below). The same stall
  can keep the P39 history check on "waiting for history" for hours during the demo. Not done in Phase 6, optional: measuring the investigator itself on rings-v2's groups (about $0.05).
- **Demo database:** migrate to 0013 (`pnpm db:migrate`) before running the web app on it.
- **C5 check:** `node --env-file-if-exists=.env.local packages/paypal/scripts/probe-purchases.ts baseline 2` lists
  the baseline merchant's purchases with payer and items; look for the 2026-11-11 lemonade (order `6NE45228XM135812U`).
- **Licence keys** in `.env.local`: `AG_STUDIO_LICENSE_KEY` (trial until 2026-12-25; its terms say
  evaluation only, production use needs a licence) and `BRYNTUM_LICENSE_KEY` (trial until 2026-12-25;
  Bryntum shows a "Trial" badge with a trial key). Both are visible in the browser by design; neither is
  in git. Restart `next dev` after adding a key: the root env file is read at startup.
- **Run the worker** next to the web app: `pnpm worker` (`--once` for one pass). Env: `REOFFER_DAYS`
  (30; shorter on the demo so returned money reaches cy-près during judging), `WORKER_INTERVAL_SECONDS`.
- **Demo timing to watch:** the 27 unclaimed items of `2HMAKHX862SAE` (Nov 10) should come back
  around Dec 10; with `REOFFER_DAYS=2` they become cy-près eligible around Dec 12, inside judging
  (until Dec 15), and need two people to send.
- **New env for the web app:** `PAYER_SEAL_KEY`, `PAYER_PSEUDONYM_KEY` (32 random bytes, base64
  each), `JUDGE_ANALYST_PASSWORD`, `JUDGE_SUPERVISOR_PASSWORD`, `NETWORK_SECRET` (`.env.example`).
- **Local run:** a database named `proofofclaim` (renamed from the working name), migrated and
  seeded (`pnpm db:migrate`, `pnpm demo:seed`, `pnpm demo:analysts` with `JUDGE_ANALYST_PASSWORD`
  and `JUDGE_SUPERVISOR_PASSWORD`), then
  `DATABASE_URL=<…>/proofofclaim SESSION_SECRET=… pnpm --filter @proofofclaim/web dev` (port 3100).
  `pnpm e2e` builds and starts its own server on port 3200; stop `next dev` in `apps/web` first
  only if you want both, since Next allows one dev server per app directory.
- **R10 (2026-11-02), built and committed:** landing page, `/demo`, `/claim/[s]` with Log in with
  PayPal, the AG Grid claims desk with the claim page and review, money with Distribute and
  read-back, `/report/[s]` with CSV; `packages/desk`; migration 0005; `pnpm demo:seed` (57 dev and
  pilot claims; the pilot matches R9 on 28 of 32, differences under Open below).

- **R2 evidence (2026-11-01):** `pnpm test` 95/95 (20 Payouts unit tests on a recorded sandbox
  batch and PayPal's real duplicate error); `pnpm test:sandbox` PASS (batch `FHT9WYQD2RX9G`:
  one SUCCESS, one UNCLAIMED, duplicate handled). Early cancel: third 500, not used.
  Details in `docs/sandbox-findings.md` → Proof of Claim: Payouts.

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
  everyone $560, model alone $160, Proof of Claim $10; honest denied 1/15; workload 2/15). Cost
  $0.04 + $0.46. `pnpm test` 710/710. Numbers: `docs/methodology.md` → pilot gate on claims-v1.

## Next action

- **Owner, before 01:30 IST 13 November:** review README.md, LIMITATIONS.md and `docs/devpost.md`; record the
  video from `docs/video-script.md` (no music; blur real restaurant names); upload it to YouTube as public;
  paste the Devpost text, tick AG Grid, Bryntum and APIMatic, submit. On GitHub (as laxmikhengare), set the
  repo's About description and website to the live URL. Keep the demo running until 21 December.
- After submission: change nothing in the repo or video (rules); only fix outages on the live site.

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
- Pushing: on the original laptop `origin` is `git@github-account4:proof-of-claim/proof-of-claim.git`;
  on the other laptop it is `git@github.com:proof-of-claim/proof-of-claim.git`. Both push as
  laxmikhengare.
