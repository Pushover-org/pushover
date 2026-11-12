# Deploying Proof of Claim (Railway)

Live: **https://web-production-3f92e595.up.railway.app** (Railway project `proof-of-claim`, environment
`production`, region US West). First deployed 2026-11-12 (plan Phase 11: P51, P52, P53).

## What runs

| Service | What it is | Settings (`.railway/railway.ts`) |
|---|---|---|
| `web` | The Next.js app | Dockerfile; migrates before going live (`preDeploy`); healthcheck `/api/health`; port 8080; sleeping off |
| `worker` | `apps/worker/src/main.ts`, a pass every 60 s | Same image; restarts always; sleeping off |
| `postgres` | Railway Postgres 18 | Private network only; no public TCP proxy. The app's database is `proofofclaim_v2` (below) |

One image serves both (`Dockerfile`: Node 24.9, pnpm 12.16.1, `next build`). `.dockerignore` and
`.gitignore` keep `.env*`, `.data/` and `CLAUDE.md` out of the upload and the image.

## Deploy

**Automatic (since 2026-11-12):** both `web` and `worker` build from GitHub,
`proof-of-claim/proof-of-claim`, branch `main` (`.railway/railway.ts`, `github(…)`). Every push to `main`
deploys, but only after the repo's CI has passed (`checkSuites: true`: lint, typecheck, unit and browser
tests); until then Railway shows the deployment as WAITING. A push to `main` changes the live site.

The eval gate does not run on these deploys: it needs the git-ignored `.data/` of the original laptop,
which CI doesn't have. Run it before pushing a change to checks, rules or prompts:

```bash
node --env-file-if-exists=.env.local scripts/eval-gate.ts   # or scripts/deploy.sh, which also deploys
```

**By hand**, from a clean tree:

```bash
scripts/deploy.sh          # web and worker
scripts/deploy.sh web      # one service
```

It deploys **committed code only** (a dirty tree is refused), after `pnpm lint`, `pnpm typecheck`,
`pnpm test` and the **eval gate** (`scripts/eval-gate.ts`, P52). The gate re-scores the recorded Haiku
pilot run (`packages/eval/results/claims-pilot-2026-11-01-haiku`) through today's checks and decision
table, for no new spend, and stops the deploy if any number is worse: fraud paid, ineligible paid, honest
claimants wrongly denied, honest workload, the GO gate, or claims reaching the expected outcome. It needs
the recorded readings and evidence images in the git-ignored `.data/` of the original laptop.
Planted regression (2026-11-12: `imageMaxDistance` 0, `taxMarginPct` 50): expected outcomes 29 → 27,
`EVAL GATE: BLOCKED`.

Infrastructure changes: edit `.railway/railway.ts`, then `railway config plan` and `railway config apply`.
The plan keeps showing two changes (`sleepApplication`, the web restart policy) after every apply;
Railway reads those back as null. The deployed manifests carry the values
(`railway status --json`: `sleepApplication=false`, `healthcheckPath=/api/health`, worker
`restartPolicyType=ALWAYS`).

Rolling back: check out the earlier commit and run `scripts/deploy.sh` (or `railway down` removes the
most recent deployment of the linked service).

## Secrets

Set once with `railway variable set NAME --stdin --service <svc>`, never in git, never printed.
`railway variable list --json` prints raw values: don't paste its output anywhere.

- Copied from `.env.local`: `PAYPAL_GUARDED_CLIENT_ID/SECRET` (web, worker), `PAYPAL_BASELINE_CLIENT_ID/SECRET`,
  `ANTHROPIC_API_KEY`, `AG_STUDIO_LICENSE_KEY`, `BRYNTUM_LICENSE_KEY` (web).
- Generated fresh for production (`openssl rand -base64 32`): `SESSION_SECRET` (web), `NETWORK_SECRET`,
  `PAYER_SEAL_KEY`, `PAYER_PSEUDONYM_KEY` (web and worker, the same values in both).
- Generated fresh: `JUDGE_ANALYST_PASSWORD`, `JUDGE_SUPERVISOR_PASSWORD` (web; play-money logins for judges).
- Set to the live domain: `PUBLIC_ORIGIN`, `PAYPAL_LOGIN_RETURN_URL` (`<origin>/api/paypal/callback`).
- `PAYPAL_GUARDED_WEBHOOK_ID` (web and worker): `8P575864EG572884E`, created by the owner on 2026-11-12 (not a secret).

AI spend on the public site is capped per server process: `DEMO_AI_BUDGET_USD=1` (examiner),
`STUDIO_AI_BUDGET_USD=0.5` (desk agent). A restart resets the cap.

## Sandbox only (P53)

`PAYPAL_API_BASE` is the sandbox. The PayPal client, `paypalCredentials` (which Log in with PayPal builds
its URL from) and the SDK client all refuse any other base URL except a local stand-in on 127.0.0.1 or
localhost (`packages/paypal/test/sdk.test.ts`).

## Demo data

The live database was loaded on 2026-11-12 without opening it to the internet:
1. A fresh local database, migrated, then `pnpm demo:seed`, `pnpm demo:analysts` and `pnpm demo:rings`
   with the **production** `NETWORK_SECRET` and judge passwords in the environment (network hashes and
   password hashes must match what the live app computes). $0 spent: readings and investigator answers
   were replayed.
2. `pg_dump --data-only --inserts`, leaving out `schema_migrations` and `policy` (the migrations own them).
   Loaded into another fresh migrated database first: identical counts (1 settlement, 57 claims,
   2 analysts, 2 groups, 60 audit rows, 41 evidence files).
3. A one-off Railway service (`postgres:17-alpine`, `DATABASE_URL=${{postgres.DATABASE_URL}}`) loaded the
   dump over the private network in one transaction, refusing if any settlement already existed
   (`SEED_LOADED settlements=1 claims=57 analysts=2`), and was then deleted.

## Owner steps (PayPal dashboard, app `pushover-guarded`): 1 and 2 done 2026-11-12

1. **Log in with PayPal (P1):** add `https://web-production-3f92e595.up.railway.app/api/paypal/callback`
   as a Return URL. Until then the claim form's PayPal login can't complete on the live site.
2. **Webhook (P38):** add a webhook with URL
   `https://web-production-3f92e595.up.railway.app/api/paypal/webhook` for the payout events
   (`PAYMENT.PAYOUTSBATCH.*` and `PAYMENT.PAYOUTS-ITEM.*`). Then set its ID:
   `railway variable set PAYPAL_GUARDED_WEBHOOK_ID=<id> --service web` and the same for `worker`.
3. **Phone:** open the live URL on a phone. Done 2026-11-12: the owner logged in with PayPal as buyer1 from a phone.

PayPal's `GET /v1/notifications/webhooks` for the guarded app lists `8P575864EG572884E` with the live
URL, subscribed to every event type (`*`). Only verified events are stored, and a stored event only makes
the worker read a payout batch back, so the extra event types do nothing.

## Checked on 2026-11-12

`/api/health` 200 `{"ok":true}`; `/`, `/settlements`, `/claim/acme-restaurant-beverage`, `/report/…`,
`/report/…/ledger`, `/login`, `/api/v1/settlements` and `/api/openapi.json` 200. In a headless browser at
iPhone 13 size: the analyst login lands on `/admin/acme-restaurant-beverage` on the same origin ("10 claims
need a person"), groups and report pages load, no page errors. Worker log: `started`, interval 60 s.
Found: on a phone the claims desk's long settlement eyebrow runs off the right edge (Phase 12).

After the owner's steps: a forged webhook (made-up signature headers) is refused, `400 signature not
verified`. **Live Log in with PayPal (P1):** the first try came back from PayPal with a code and was then
redirected to `https://localhost:8080/…`: behind Railway's proxy the request's own origin is the
container's. Fixed in `37424d5` (every redirect uses `PUBLIC_ORIGIN`, `apps/web/lib/server/origin.ts`).
Then, in a headless browser as sandbox buyer1: the claim form shows "Signed in as Dana Reyes · verified
account". Railway's Postgres is version 18 (`postgres-ssl:18`); we develop on 17, and all 13 migrations
ran on it.

## The second database (2026-11-12)

The first live payout round collided with this laptop's: batch IDs were `poc-<settlement>-r<round>-p<part>`,
and the laptop's database had already sent `poc-acme-restaurant-beverage-r1-p1` on the same sandbox app.
PayPal refused the repeat and the desk, as built for retries, adopted the laptop's batch `2HMAKHX862SAE`
(10 items) as the deployment's round 1 (planned: 3 claims, $40). No money moved twice. Fixed in `0ba1820`:
migration 0014 names each database (`deployment_instance`, 10 hex characters) and every batch ID carries it.

Emptying the live database was refused as a mass delete, so nothing was deleted: the Postgres service's
default database keeps the first deployment's records as they are, and the app moved to a new database,
`proofofclaim_v2`, made by a one-off service (`CREATE DATABASE`, additive), migrated by the web deploy,
loaded from the same dump (`SEED_LOADED db=proofofclaim_v2 settlements=1 claims=57 analysts=2
instance=47b3bd0413`), and the one-off service deleted. `DATABASE_URL` is built by Railway from the
Postgres service's private parts (`.railway/railway.ts`); switching back is that one variable.

Then, as the demo analyst, both linked groups were denied (all six claims are labelled fraud in claims-v1:
F5 template crew c-037, c-062, c-098, c-148; F6 shared inbox c-029, c-036), the analyst proposed round 1
(3 payments, $40.00) and the supervisor approved it. PayPal's record of batch `UN6TR3QNHZV4C`:
`sender_batch_id poc-47b3bd0413-acme-restaurant-beverage-r1-p1`, SUCCESS, $40.00; c-007 $15, c-010 $10,
c-012 $15, each UNCLAIMED (`RECEIVER_UNREGISTERED`: the labelled set's addresses are fictional), so that
money returns after 30 days and goes through the re-offer window to cy-près. `/judge` shows this trail.
