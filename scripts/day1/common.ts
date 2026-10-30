import { limiterFromEnv, paypalClientFromEnv, type PayPalApp, type PayPalClient } from "@pushover/paypal";

/** A client for one sandbox app whose fetch counts OAuth token requests. */
export function countingClient(app: PayPalApp): { client: PayPalClient; tokenRequests: () => number } {
  let tokens = 0;
  const fetchCounting: typeof fetch = (input, init) => {
    if (String(input).endsWith("/v1/oauth2/token")) tokens++;
    return fetch(input, init);
  };
  const client = paypalClientFromEnv(app, limiterFromEnv(), { fetch: fetchCounting, maxAttempts: 1 });
  return { client, tokenRequests: () => tokens };
}

/** Error fields that are safe to publish: no headers, no tokens. */
export function describeError(err: unknown) {
  if (err instanceof Error && "status" in err) {
    const e = err as Error & { status: number; issue?: string; debugId?: string; body?: { name?: string; message?: string } };
    return { type: e.name, status: e.status, name: e.body?.name, issue: e.issue, message: e.body?.message, debug_id: e.debugId };
  }
  return { type: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message : String(err) };
}
