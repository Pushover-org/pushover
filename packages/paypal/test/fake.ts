import { vi } from "vitest";
import type { RateLimiter } from "../src/bucket.ts";
import { PayPalClient, type PayPalClientOptions } from "../src/client.ts";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Reply = Response | Error | ((call: Call) => Response | Error | Promise<Response | Error>);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export const tokenReply = (token = "tok-1", expiresIn = 32400) =>
  json(200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });

/** A fake fetch that answers the OAuth endpoint and a scripted queue of API replies. */
export function fakePayPal(apiReplies: Reply[], tokenReplies: Reply[] = []) {
  const calls: Call[] = [];
  const tokenCalls: Call[] = [];
  let tokenCount = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    let reply: Reply | undefined;
    if (url.endsWith("/v1/oauth2/token")) {
      tokenCalls.push(call);
      reply = tokenReplies.shift() ?? tokenReply(`tok-${++tokenCount}`);
    } else {
      calls.push(call);
      reply = apiReplies.shift();
      if (!reply) throw new Error(`unexpected request ${call.method} ${url}`);
    }
    const r = typeof reply === "function" ? await reply(call) : reply;
    if (r instanceof Error) throw r;
    return r;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, tokenCalls };
}

export const noLimit: RateLimiter = { take: async () => undefined };

export function makeClient(fetch: typeof globalThis.fetch, extra: Partial<PayPalClientOptions> = {}) {
  const sleeps: number[] = [];
  const client = new PayPalClient({
    baseUrl: "https://api-m.sandbox.paypal.com",
    clientId: "id",
    clientSecret: "secret",
    limiter: noLimit,
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    logger: { warn: () => undefined },
    ...extra,
  });
  return { client, sleeps };
}

export function timeoutError(): Error {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}
