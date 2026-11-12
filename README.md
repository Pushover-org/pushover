# Proof of Claim

**A claims desk for class-action settlements. We check the person and the proof.**

An AI reads each claim's receipt and reports what it shows. Plain rules decide. A person approves the
money, PayPal pays it, and money nobody claims goes to the court's chosen nonprofit (cy-près). The
model never decides a claim and never moves money.

- **Live demo:** https://web-production-3f92e595.up.railway.app
- **Judges, start here:** https://web-production-3f92e595.up.railway.app/judge (sandbox logins, an
  eight-step tour, and what is switched on right now)
- Fictional settlement, PayPal **sandbox** only, play money. Nothing here can reach real PayPal.

## For judges

| What | Where | Sign-in |
|---|---|---|
| **Start here:** the sandbox logins, an eight-step tour, a real payout traced end to end, and what is switched on right now | [/judge](https://web-production-3f92e595.up.railway.app/judge) | None |
| **Watch the AI get overruled:** Claude approves a fake receipt; the tax rule denies it and says why | [Landing page](https://web-production-3f92e595.up.railway.app/) | None |
| **File a claim yourself** with Log in with PayPal and see the decision on the spot | [/claim](https://web-production-3f92e595.up.railway.app/claim/acme-restaurant-beverage) | Sandbox buyer 4, 5 or 6 ([below](#sandbox-test-accounts-play-money)); change the street address |
| **The claims desk:** every claim, its twelve checks and reasons; filter "Model said ≠ rules said" | [/admin](https://web-production-3f92e595.up.railway.app/admin/acme-restaurant-beverage) | Analyst login (on /judge) |
| **Move money with two people:** an analyst proposes, a different supervisor approves, PayPal Payouts pays, every item is read back | [/money](https://web-production-3f92e595.up.railway.app/admin/acme-restaurant-beverage/money) | Analyst, then supervisor (on /judge) |
| **The public record:** the court report, and the ledger verified in your browser | [/report](https://web-production-3f92e595.up.railway.app/report/acme-restaurant-beverage) | None |
| **The numbers:** pre-registered, 100 held-out claims, every miss named | [Results](#results-pre-registered-measured) · [docs/methodology.md](docs/methodology.md) | — |
| **What it does not prove** | [LIMITATIONS.md](LIMITATIONS.md) | — |

### What's different

1. **The AI examines the evidence, and the rules can overrule it.** Claude reads each receipt photo
   into structured findings; twelve checks in code (class period, product, arithmetic, sales tax
   against the store's address, duplicate images, and more) decide. On 100 held-out claims the rules
   overruled the AI's "approve" 30 times, and 7 fake receipts were caught by a tax rate their store
   can't charge.
2. **Money needs two people.** An analyst proposes the exact round and signs it; a different
   supervisor approves; only then is PayPal called.
3. **Unclaimed money goes to the court's charity (cy-près)**, after a re-offer window, in a second
   PayPal Payouts batch, again with two people.
4. **A pre-registered test with honest misses.** The claims, labels and pass mark were committed
   before any run: $40 of fraud paid against $1,620 if everyone were paid, and 3 of 41 honest
   claimants wrongly denied, each one named in [docs/methodology.md](docs/methodology.md).

## The problem

Settlement funds are now flooded with fake claims, and the usual answers are to pay everyone or to
deny in bulk.

- One administrator received **80 million** fraudulent claims in 2023, up 19,000% since 2021
  ([Jones Day](https://www.jonesday.com/en/insights/2024/06/rising-fraudulent-claims-submitted-to-class-action-settlement-funds)).
- **49%** of 1.77 million claims in the Celsius settlement were fraudulent
  ([FRT](https://frtservices.com/insights/administration-challenges-part-1-fraudulent-claims/)).
- **$79B+** was paid in US class-action settlements in 2025
  ([Duane Morris](https://blogs.duanemorris.com/classactiondefense/2026/01/08/dmcar-trend-1-settlement-numbers-broke-the-40-billion-mark-for-the-fourth-year-in-a-row/)).

Every fake claim paid is money taken from a real class member.

## How it works

```
claimant ──Log in with PayPal──▶ one verified account, one claim
   │
   ▼
receipt photo ──▶ AI examiner (Claude Haiku 5.5) ──▶ structured findings only (no tool that decides or pays)
                                                        │
                                                        ▼
                         12 checks in code ──▶ decision table v1 ──▶ APPROVE · DENY · NEED_MORE · REVIEW
                         (unknown is never a pass)       │                (every decision stored with its rule and reason)
                                                        ▼
       analyst proposes a round ──▶ a different supervisor approves ──▶ PayPal Payouts batch
                                                        │
             read back item by item ◀── PayPal ──▶ verified webhooks ──▶ PayPal's own history (Transaction Search)
                                                        │
          unclaimed after 30 days ──▶ re-offer window ──▶ two people send it to the nonprofit (a second Payouts batch)
```

- **Log in with PayPal.** Each claim is tied to one verified PayPal account, and the payout goes to that
  account's PayPal ID. A farm of fake identities has nowhere to send the money.
- **The examiner** (Claude) reads the receipt and returns findings in a fixed schema: merchant, address,
  date, line items, subtotal, tax, total. It also gives its own recommendation, which the rules ignore.
- **Twelve checks in code:** class period, qualifying product, arithmetic, tax plausibility (the tax
  rate must fit the store's address, from a cited rate table), geography, duplicate image, template
  declarations, identity dedupe, velocity, visual anomaly, units cap, repeat receipt details. Each one
  passes, fails or says it can't tell, and "can't tell" is never a pass.
- **A versioned decision table** turns the checks into an outcome. A person reviews every REVIEW.
- **Linked groups** (shared device, inbox or near-identical words) are held for a person. An AI
  investigator writes what it sees and how sure it is; it only recommends.
- **Money needs two people.** An analyst proposes the exact round, a different supervisor approves it,
  and only then is PayPal called. Every item is read back from PayPal, checked against PayPal's own
  transaction history, and shown as unconfirmed until PayPal confirms it.
- **Cy-près.** Unclaimed money comes back after 30 days, is offered again to the claimant, and then
  goes to the court's chosen nonprofit in a second Payouts batch, again with two people.
- **Public proof.** A court report totals every dollar. A public ledger commits each round's
  decisions so anyone can check, in the browser, that a claim's decision is in the record.
- **Assistants can file for people** through an MCP server (`/api/mcp`) or a JSON API
  ([OpenAPI](https://web-production-3f92e595.up.railway.app/api/openapi.json)). An assistant's claim
  waits until its person confirms it with Log in with PayPal.

## Results (pre-registered, measured)

The claim set (`packages/eval/corpus/claims-v1/`, 157 claims), its labels and the pass mark were
committed to git before any run. Three ways to run the same claims: **A** pay everyone, **B** ask the
model alone to approve or deny, **C** Proof of Claim.

**Held-out run, 100 claims no rule or prompt was tuned on** (41 honest, 45 fraud, 14 that don't qualify),
2026-11-12, [`packages/eval/results/claims-holdout-2026-11-12-haiku`](packages/eval/results/claims-holdout-2026-11-12-haiku):

| | A pay everyone | B model alone | **C Proof of Claim** |
|---|---|---|---|
| Fraud paid (Haiku 5.5) | $1,620.00 | $700.00 | **$40.00** (worst case, every review approved: $245) |
| Honest claimants wrongly denied | none (pays everyone) | 8 of 41 | **3 of 41** (7.3%, 95% CI 2.5–19.4%) |
| Honest claims sent to a person or asked for a document | — | — | 8 of 41 (19.5%) |
| Ineligible paid | $225.00 | $0.00 | $0.00 |
| Claims reaching the expected outcome | | | 86 of 100 |

- The examiner said "approve" and the rule said deny or review **30 times**; 28 of those were fraud or
  didn't qualify, 2 were honest claimants we got wrong. **7** fake receipts were caught by a sales tax
  their store's address can't have.
- Sonnet 5.5 on the same claims: fraud paid $40.00, honest denied 2 of 41, 87 of 100 as expected.
  Both models pass the pre-registered gate (GO). Haiku stays the main model at about a tenth of the cost
  ($0.13 vs $1.50 for the whole run).
- Every miss is named in [`docs/methodology.md`](docs/methodology.md): two honest rendered receipts
  denied as duplicate images, one drink line Haiku misread, four no-receipt frauds paid $10 each.
- **Fraud rings** on a separate held-out set of 5,000 synthetic claims: 80.0% of ring claims grouped,
  84.9% of grouped claims are fraud, 6.3% of honest claimants held for a person; households are held
  most (27.6%), which is why a group is held, never denied, by the code.

## Real money path (PayPal sandbox)

On the live demo, 12 November 2026:

- Round 1, batch `UN6TR3QNHZV4C`: 3 payments, $40.00, all UNCLAIMED (the labelled set's addresses are
  fictional, so they come back).
- Round 2, batch `YPBRD2TBA4Y9A`: 24 payments, $455.00, fees $6.00. Dana Reyes (sandbox buyer) filed a
  claim through Log in with PayPal, was approved, and her **$10.00 arrived in her PayPal account
  (SUCCESS)**; 23 came back UNCLAIMED and will reach the nonprofit during judging.
- Two more sandbox buyers were **denied as duplicates**: PayPal gives every sandbox buyer the same
  default address, and the identity check caught it.

Details: [`docs/deploy.md`](docs/deploy.md), [`docs/sandbox-findings.md`](docs/sandbox-findings.md).

## What this does not prove

Read [`LIMITATIONS.md`](LIMITATIONS.md). In short: the fakes are synthetic, the settlement is fictional,
the honest set is small (41 held-out claimants, wide intervals), real receipts come from one public
restaurant dataset, the labels were transcribed with AI help, and no real claims administrator has run
it yet.

## Try it in two minutes

1. Open [`/judge`](https://web-production-3f92e595.up.railway.app/judge).
2. **File a claim** as sandbox buyer 4, 5 or 6 (table below; play money): Log in with PayPal on the
   sandbox login page, then file with or without a receipt photo. PayPal's sandbox gives every test buyer the same address. Change the street address on the form,
   or the duplicate rule will deny the claim, as it should. Dana Reyes (buyer1) already has a paid claim.
3. **Log in as the analyst**, then the supervisor (logins on `/judge`), to review claims and move money.

Everyone shares the one demo, so you will see what earlier visitors did.

### Sandbox test accounts (play money)

These log in only at PayPal's sandbox (sandbox.paypal.com), never at paypal.com.

| Account | Email | Password |
|---|---|---|
| buyer1 (Dana Reyes) | `po-buyer1-3h8w@personal.example.com` | `Dr5$yKm8Qa` |
| buyer4 | `po-buyer4-3h8w@personal.example.com` | `Ks2$hRv8Mb` |
| buyer5 | `po-buyer5-3h8w@personal.example.com` | `Lw6!fJd9Tc` |
| buyer6 | `po-buyer6-3h8w@personal.example.com` | `Ob3#zNg7Xu` |

## Run it yourself

Needs Node 24, pnpm 12.16.1, Docker (Postgres 17) and two PayPal sandbox apps.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # fill in the PayPal sandbox apps, DATABASE_URL, the keys it lists
docker run -d --name pushover-pg -e POSTGRES_USER=pushover -e POSTGRES_PASSWORD=<random> \
  -e POSTGRES_DB=pushover -p 127.0.0.1:5433:5432 postgres:17-alpine
pnpm db:migrate
pnpm demo:seed                    # the demo settlement (reads receipts; about $0.03 without the cache)
pnpm demo:analysts                # the two judge logins (JUDGE_ANALYST_PASSWORD, JUDGE_SUPERVISOR_PASSWORD)
pnpm --filter @proofofclaim/web dev   # http://localhost:3100
pnpm worker                       # read-backs, PayPal history, re-offers, cy-près eligibility
```

Without `ANTHROPIC_API_KEY`, receipt claims go to a person unread; everything else works.

Checks: `pnpm lint && pnpm typecheck && pnpm test` (1,004 tests), `pnpm e2e` (Playwright, against a
fake PayPal on localhost). The eval: `pnpm eval:claims --run-id <id> --model claude-haiku-5-5 --split holdout --check`
prints the cost before spending anything. Deploying: [`docs/deploy.md`](docs/deploy.md) (Railway, with
an eval gate before every deploy).

## Code map

| Path | What it is |
|---|---|
| `apps/web` | Next.js app: claim form, claims desk, money, court report, ledger, `/judge`, MCP and JSON API |
| `apps/worker` | Runs every minute: webhooks, read-backs, PayPal history, re-offers, cy-près eligibility |
| `packages/examiner` | The Claude receipt reader and the ring investigator; may not import PayPal code (lint-enforced) |
| `packages/checks` | The twelve checks, ring detection, the cited tax table (`data/tax-rates.json`) |
| `packages/claims` | Settlement config, reason codes, decision table v1 |
| `packages/distribute` | Allocation (whole cents, pro rata, largest remainders), batching, reconciliation |
| `packages/paypal` | Payouts, Log in with PayPal, webhooks verification; balances and Transaction Search through PayPal's Server SDK |
| `packages/ledger` | The public ledger's commitments |
| `packages/desk` | The claims desk: filing, deciding, two-person money, cy-près |
| `packages/db` | Postgres migrations and queries |
| `packages/eval` | The labelled claim sets, the independent oracle, the eval runner and results |

## Built with

- **PayPal:** Payouts (batches, item read-back), Log in with PayPal (verified status and payer ID),
  Webhooks (signature verification), Transaction Search and Balances through
  **PayPal's Server SDK** (`@paypal/paypal-server-sdk`, generated by **APIMatic**; set up with the
  APIMatic Context Plugin for PayPal, see `docs/architecture.md`).
- **AI:** Claude Haiku 5.5 (receipt examiner, ring investigator) and Claude Sonnet 5.5 (comparison) via
  the Anthropic API, with a hard spend cap; Model Context Protocol server for assistants.
- **AG Grid** (claims and payout grids) and **AG Studio** ("Ask the desk").
- **Bryntum Scheduler** (the linked-groups timeline).
- Next.js, TypeScript, PostgreSQL, Railway, Playwright, Vitest.

## How we got here

We first built **Pushover**, a guard for AI support agents that can issue refunds, and pre-registered a
test of whether Claude agents could be talked into bad refunds. They couldn't: 0 of 33 attacks leaked on
both Haiku 5.5 and Sonnet 5.5, so we stopped at our own NO-GO
([`docs/research-findings.md`](docs/research-findings.md)) and moved to where the fraud actually is:
claims against settlement funds. The code from that phase is at tag `pushover-final`.

## AI assistance

This project was built with AI coding assistance (Claude Code). See [`AI_ASSISTANCE.md`](AI_ASSISTANCE.md)
for what that covered and how it was checked.

## Licence

[MIT](LICENSE).
