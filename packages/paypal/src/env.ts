import { SlidingWindowLimiter, type RateLimiter } from "./bucket.ts";
import { PayPalClient, type PayPalClientOptions } from "./client.ts";

export type PayPalApp = "guarded" | "baseline";

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

/** Credentials for one sandbox app, read from the spec §4.4 variable names. */
export function paypalCredentials(app: PayPalApp, env: Env = process.env) {
  const prefix = app === "guarded" ? "PAYPAL_GUARDED" : "PAYPAL_BASELINE";
  return {
    baseUrl: required(env, "PAYPAL_API_BASE"),
    clientId: required(env, `${prefix}_CLIENT_ID`),
    clientSecret: required(env, `${prefix}_CLIENT_SECRET`),
  };
}

export function limiterFromEnv(env: Env = process.env): SlidingWindowLimiter {
  const rpm = Number(env["PAYPAL_RPM"] ?? "40");
  return new SlidingWindowLimiter({ perMinute: rpm });
}

export function paypalClientFromEnv(
  app: PayPalApp,
  limiter: RateLimiter,
  extra: Partial<PayPalClientOptions> = {},
  env: Env = process.env,
): PayPalClient {
  return new PayPalClient({ ...paypalCredentials(app, env), limiter, ...extra });
}
