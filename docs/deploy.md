# Deploying Proof of Claim (Railway)

Live: **https://web-production-3f92e595.up.railway.app** (Railway project `proof-of-claim`, environment
`production`, region US West). First deployed 2026-11-12 (plan Phase 11: P51, P52, P53).

## What runs

| Service | What it is | Settings (`.railway/railway.ts`) |
|---|---|---|
| `web` | The Next.js app | Dockerfile; migrates before going live (`preDeploy`); healthcheck `/api/health`; port 8080; sleeping off |
| `worker` | `apps/worker/src/main.ts`, a pass every 60 s | Same image; restarts always; sleeping off |
| `postgres` | Railway Postgres | Private network only; no public TCP proxy |

One image serves both (`Dockerfile`: Node 24.9, pnpm 12.16.1, `next build`). `.dockerignore` and
`.gitignore` keep `.env*`, `.data/` and `CLAUDE.md` out of the upload and the image.

## Deploy

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
The plan keeps showing four changes (`source.type`, `sleepApplication`, the web restart policy) after
every apply; Railway reads those back as null. The deployed manifests carry the values
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
- Not set yet: `PAYPAL_GUARDED_WEBHOOK_ID` (owner step below).

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

## Owner steps (PayPal dashboard, app `pushover-guarded`)

1. **Log in with PayPal (P1):** add `https://web-production-3f92e595.up.railway.app/api/paypal/callback`
   as a Return URL. Until then the claim form's PayPal login can't complete on the live site.
2. **Webhook (P38):** add a webhook with URL
   `https://web-production-3f92e595.up.railway.app/api/paypal/webhook` for the payout events
   (`PAYMENT.PAYOUTSBATCH.*` and `PAYMENT.PAYOUTS-ITEM.*`). Then set its ID:
   `railway variable set PAYPAL_GUARDED_WEBHOOK_ID=<id> --service web` and the same for `worker`.
3. **Phone:** open the live URL on a phone.

## Checked on 2026-11-12

`/api/health` 200 `{"ok":true}`; `/`, `/settlements`, `/claim/acme-restaurant-beverage`, `/report/…`,
`/report/…/ledger`, `/login`, `/api/v1/settlements` and `/api/openapi.json` 200. In a headless browser at
iPhone 13 size: the analyst login lands on `/admin/acme-restaurant-beverage` on the same origin ("10 claims
need a person"), groups and report pages load, no page errors. Worker log: `started`, interval 60 s.
Found: on a phone the claims desk's long settlement eyebrow runs off the right edge (Phase 12).
