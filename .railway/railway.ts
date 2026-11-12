// Proof of Claim on Railway (plan item P51; Pushover spec §8): the web app, the worker and Postgres.
// Option names are from the `railway` package's own types (railway/iac, 3.16.0).
//   railway config plan     preview; values are redacted
//   railway config apply    make Railway match this file
// Deploys go through scripts/deploy.sh, which runs the eval gate (P52) before `railway up`.
//
// Non-secrets are written here. Secrets use preserve(): they are set once with `railway variables`
// (docs/deploy.md) and this file never sees or overwrites their values.
import { defineRailway, empty, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  const shared = {
    // The app's own database on the Postgres service, built from its private parts by Railway (the
    // password never appears here). proofofclaim_v2 since 2026-11-12; the service's default database
    // keeps the first deployment's records (docs/deploy.md).
    DATABASE_URL: "postgresql://${{postgres.PGUSER}}:${{postgres.PGPASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/proofofclaim_v2",
    // Sandbox only: the PayPal client refuses any other base URL (P53).
    PAYPAL_ENV: "sandbox",
    PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
    // Shared with the worker through Postgres; under the sandbox's 50 a minute.
    PAYPAL_RPM: "40",
    PAYPAL_GUARDED_CLIENT_ID: preserve(),
    PAYPAL_GUARDED_CLIENT_SECRET: preserve(),
    PAYPAL_GUARDED_WEBHOOK_ID: preserve(),
    NETWORK_SECRET: preserve(),
    PAYER_SEAL_KEY: preserve(),
    PAYER_PSEUDONYM_KEY: preserve(),
  };

  const web = service("web", {
    source: empty(),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // A failing migration stops the deploy; the old one keeps serving.
    preDeploy: "node packages/db/src/bin/migrate.ts",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: 1,
    deploy: { sleepApplication: false, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    env: {
      ...shared,
      // The port the public domain forwards to; `next start` listens on $PORT (Dockerfile).
      PORT: "8080",
      PAYPAL_BASELINE_CLIENT_ID: preserve(),
      PAYPAL_BASELINE_CLIENT_SECRET: preserve(),
      SESSION_SECRET: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      PUSHOVER_MODEL: "claude-haiku-5-5",
      COMPARE_MODEL: "claude-sonnet-5-5",
      // Most the public site's examiner and desk agent may spend per server process, in USD.
      DEMO_AI_BUDGET_USD: "1",
      STUDIO_AI_BUDGET_USD: "0.5",
      PUBLIC_ORIGIN: preserve(),
      PAYPAL_LOGIN_RETURN_URL: preserve(),
      JUDGE_ANALYST_PASSWORD: preserve(),
      JUDGE_SUPERVISOR_PASSWORD: preserve(),
      // The sandbox buyer judges log in with (play money; spec §3.0 marks it safe to publish).
      JUDGE_BUYER_EMAIL: preserve(),
      JUDGE_BUYER_PASSWORD: preserve(),
      AG_STUDIO_LICENSE_KEY: preserve(),
      BRYNTUM_LICENSE_KEY: preserve(),
    },
  });

  const worker = service("worker", {
    source: empty(),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node apps/worker/src/main.ts",
    replicas: 1,
    deploy: { sleepApplication: false, restartPolicyType: "ALWAYS" },
    env: { ...shared, WORKER_INTERVAL_SECONDS: "60" },
  });

  return project("proof-of-claim", { resources: [db, web, worker] });
});
