// How PayPal's Server SDK is wired in (src/sdk.ts): its token, our rate limiter, its retries, our
// error types, and the sandbox-only base URL. Fake PayPal answers; no network except a local server.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { RateLimiter } from "../src/bucket.ts";
import { PayPalClient } from "../src/client.ts";
import { paypalCredentials } from "../src/env.ts";
import { PayPalApiError, PayPalNetworkError } from "../src/errors.ts";
import { getBalance } from "../src/reporting.ts";
import { SANDBOX_API, standInFor } from "../src/sdk.ts";
import { fakePayPal, json, makeClient, tokenReply } from "./fake.ts";

const usd = (value: string) => ({ currency_code: "USD", value });
const balanceReply = () => json(200, { balances: [{ currency: "USD", total_balance: usd("10.00"), available_balance: usd("10.00") }], as_of_time: "2026-11-10T03:59:59Z" });
const header = (h: Record<string, string>, name: string) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];

describe("PayPal's Server SDK, as wired in here", () => {
  it("fetches its own token with the app's credentials and sends it on the call", async () => {
    const pp = fakePayPal([balanceReply()], [tokenReply("tok-sdk")]);
    const { client } = makeClient(pp.fetch);
    await getBalance(client);
    expect(pp.tokenCalls).toHaveLength(1);
    expect(header(pp.tokenCalls[0]?.headers ?? {}, "authorization")).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(pp.tokenCalls[0]?.body).toContain("grant_type=client_credentials");
    expect(header(pp.calls[0]?.headers ?? {}, "authorization")).toBe("Bearer tok-sdk");
  });

  it("keeps the token for the next call", async () => {
    const pp = fakePayPal([balanceReply(), balanceReply()]);
    const { client } = makeClient(pp.fetch);
    await getBalance(client);
    await getBalance(client);
    expect(pp.tokenCalls).toHaveLength(1);
    expect(pp.calls).toHaveLength(2);
  });

  it("retries a 503 on a GET, and every attempt waits for the rate limiter, the token request included", async () => {
    let takes = 0;
    const counting: RateLimiter = { take: async () => void takes++ };
    const pp = fakePayPal([json(503, { name: "SERVICE_UNAVAILABLE" }), balanceReply()]);
    const { client } = makeClient(pp.fetch, { limiter: counting });
    expect((await getBalance(client)).availableCents).toBe(1000);
    expect(pp.calls).toHaveLength(2);
    expect(takes).toBe(3);
  });

  it("gives PayPal's error back as a PayPalApiError with its name and debug ID", async () => {
    const pp = fakePayPal([json(403, { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." }, { "paypal-debug-id": "f00d" })]);
    const { client } = makeClient(pp.fetch);
    const err = await getBalance(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 403, issue: "NOT_AUTHORIZED", path: "/v1/reporting/balances", debugId: "f00d" });
    // A definite refusal is not sent again (the runtime would, with retryOnTimeout on).
    expect(pp.calls).toHaveLength(1);
  });

  it("a failed token fetch fails that call only: the next call asks for a token again", async () => {
    const pp = fakePayPal([balanceReply()], [json(401, { error: "invalid_client", error_description: "Client Authentication failed" }), tokenReply("tok-2")]);
    const { client } = makeClient(pp.fetch);
    const err = await getBalance(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 401, path: "/v1/oauth2/token" });
    expect(pp.calls).toHaveLength(0);
    expect((await getBalance(client)).availableCents).toBe(1000);
    expect(pp.tokenCalls).toHaveLength(2);
    expect(header(pp.calls[0]?.headers ?? {}, "authorization")).toBe("Bearer tok-2");
  });

  it("a call that can't reach PayPal is a PayPalNetworkError", async () => {
    const pp = fakePayPal([new TypeError("fetch failed")]);
    const { client } = makeClient(pp.fetch, { maxAttempts: 1 });
    const err = await getBalance(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalNetworkError);
    expect(err).toMatchObject({ path: "/v1/reporting/balances" });
  });
});

describe("where the SDK may send requests", () => {
  it("the sandbox, or a stand-in on this machine; never anywhere else", () => {
    expect(standInFor(SANDBOX_API)).toBeNull();
    expect(standInFor(`${SANDBOX_API}/`)).toBeNull();
    expect(standInFor("http://127.0.0.1:4010")).toBe("http://127.0.0.1:4010");
    expect(standInFor("http://localhost:4010/")).toBe("http://localhost:4010");
    expect(() => standInFor("https://api-m.paypal.com")).toThrow("only talks to the sandbox");
    expect(() => standInFor("http://127.0.0.1.example.com")).toThrow("only talks to the sandbox");
    // Plan item P53: the client itself refuses production, and so does reading it from the environment.
    expect(() => new PayPalClient({ baseUrl: "https://api-m.paypal.com", clientId: "id", clientSecret: "secret", limiter: { take: async () => undefined } })).toThrow("only talks to the sandbox");
    expect(() => paypalCredentials("guarded", { PAYPAL_API_BASE: "https://api-m.paypal.com", PAYPAL_GUARDED_CLIENT_ID: "id", PAYPAL_GUARDED_CLIENT_SECRET: "secret" })).toThrow("only talks to the sandbox");
    expect(paypalCredentials("guarded", { PAYPAL_API_BASE: SANDBOX_API, PAYPAL_GUARDED_CLIENT_ID: "id", PAYPAL_GUARDED_CLIENT_SECRET: "secret" }).baseUrl).toBe(SANDBOX_API);
  });

  it("a local stand-in gets the token request as well as the call, over the SDK's own transport", async () => {
    const seen: string[] = [];
    const server = createServer((req: IncomingMessage, res) => {
      seen.push(`${req.method} ${new URL(req.url ?? "/", "http://x").pathname} ${req.headers.authorization?.split(" ")[0] ?? "-"}`);
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/v1/oauth2/token") return res.end(JSON.stringify({ access_token: "local", token_type: "Bearer", expires_in: 32400 }));
        res.end(JSON.stringify({ balances: [{ currency: "USD", total_balance: usd("5.00"), available_balance: usd("5.00") }], as_of_time: "2026-11-10T03:59:59Z" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const client = new PayPalClient({ baseUrl: `http://127.0.0.1:${port}`, clientId: "id", clientSecret: "secret", limiter: { take: async () => undefined } });
      expect((await getBalance(client)).availableCents).toBe(500);
      expect(seen).toEqual(["POST /v1/oauth2/token Basic", "GET /v1/reporting/balances Bearer"]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
