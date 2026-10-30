import { describe, expect, it } from "vitest";
import { PayPalApiError, PayPalNetworkError, PayPalUnknownOutcomeError } from "../src/errors.ts";
import { refundCapture } from "../src/refunds.ts";
import { fakePayPal, json, makeClient, timeoutError, tokenReply } from "./fake.ts";

const created = () => json(201, { id: "R1", status: "COMPLETED" });
const post = (client: ReturnType<typeof makeClient>["client"], requestId = "rr-1") =>
  client.request("POST", "/v2/payments/captures/C1/refund", { requestId, body: { amount: { currency_code: "USD", value: "1.00" } } });

describe("PayPalClient", () => {
  it("refuses a POST without a requestId and sends nothing", async () => {
    const pp = fakePayPal([]);
    const { client } = makeClient(pp.fetch);
    await expect(client.request("POST", "/v2/payments/captures/C1/refund", { body: {} })).rejects.toThrow(/requires requestId/);
    expect(pp.fetch).not.toHaveBeenCalled();
  });

  it("honours Retry-After on 429", async () => {
    const pp = fakePayPal([json(429, { name: "RATE_LIMIT_REACHED" }, { "retry-after": "7" }), json(200, { id: "O1" })]);
    const { client, sleeps } = makeClient(pp.fetch);
    await expect(client.request("GET", "/v2/checkout/orders/O1")).resolves.toEqual({ id: "O1" });
    expect(sleeps).toEqual([7000]);
  });

  it("retries a 5xx POST with the same PayPal-Request-Id", async () => {
    const pp = fakePayPal([json(500, { name: "INTERNAL_SERVER_ERROR" }), json(503, {}), created()]);
    const { client } = makeClient(pp.fetch);
    await expect(post(client)).resolves.toEqual({ id: "R1", status: "COMPLETED" });
    expect(pp.calls.map((c) => c.headers["PayPal-Request-Id"])).toEqual(["rr-1", "rr-1", "rr-1"]);
  });

  it("retries 409 PREVIOUS_REQUEST_IN_PROGRESS with the same key", async () => {
    const inProgress = json(409, { name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] });
    const pp = fakePayPal([inProgress, created()]);
    const { client } = makeClient(pp.fetch);
    await expect(post(client)).resolves.toMatchObject({ id: "R1" });
    expect(pp.calls.map((c) => c.headers["PayPal-Request-Id"])).toEqual(["rr-1", "rr-1"]);
  });

  it("turns repeated POST timeouts into an unknown outcome, never a plain failure", async () => {
    const pp = fakePayPal([timeoutError(), timeoutError(), timeoutError(), timeoutError()]);
    const { client } = makeClient(pp.fetch);
    const err = await post(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalUnknownOutcomeError);
    expect((err as PayPalUnknownOutcomeError).requestId).toBe("rr-1");
    expect(pp.calls).toHaveLength(4);
    expect(new Set(pp.calls.map((c) => c.headers["PayPal-Request-Id"]))).toEqual(new Set(["rr-1"]));
  });

  it("keeps the outcome unknown when a definite error follows an ambiguous attempt", async () => {
    // The first attempt may have refunded everything; a later 422 cannot prove it did not.
    const exceeded = json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }] });
    const pp = fakePayPal([timeoutError(), exceeded]);
    const { client } = makeClient(pp.fetch);
    await expect(post(client)).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
  });

  it("keeps the outcome unknown when PayPal is still in progress after the last attempt", async () => {
    const inProgress = () => json(409, { name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] });
    const pp = fakePayPal([inProgress(), inProgress(), inProgress(), inProgress()]);
    const { client } = makeClient(pp.fetch);
    await expect(post(client)).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
  });

  it("reports a clean 422 on a POST as a definite API error with the issue", async () => {
    const pp = fakePayPal([json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "TRANSACTION_DISPUTED" }] }, { "paypal-debug-id": "dbg1" })]);
    const { client } = makeClient(pp.fetch);
    const err = await post(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, issue: "TRANSACTION_DISPUTED", debugId: "dbg1" });
    expect(pp.calls).toHaveLength(1);
  });

  it("parses a 404 on GET", async () => {
    const pp = fakePayPal([json(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] })]);
    const { client } = makeClient(pp.fetch);
    await expect(client.request("GET", "/v2/checkout/orders/BOGUS")).rejects.toMatchObject({ status: 404, issue: "INVALID_RESOURCE_ID" });
  });

  it("wraps a GET network failure", async () => {
    const pp = fakePayPal([timeoutError(), timeoutError(), timeoutError(), timeoutError()]);
    const { client } = makeClient(pp.fetch);
    await expect(client.request("GET", "/v2/checkout/orders/O1")).rejects.toBeInstanceOf(PayPalNetworkError);
  });

  it("refreshes the token once on 401, then gives up", async () => {
    const unauthorized = () => json(401, { error: "invalid_token" });
    const pp = fakePayPal([unauthorized(), unauthorized()]);
    const { client } = makeClient(pp.fetch);
    await expect(client.request("GET", "/v2/checkout/orders/O1")).rejects.toMatchObject({ status: 401 });
    expect(pp.tokenCalls).toHaveLength(2);
    expect(pp.calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("refreshes the token on 403 NOT_AUTHORIZED (a token minted before a scope was added)", async () => {
    const pp = fakePayPal([json(403, { name: "NOT_AUTHORIZED" }), json(200, { ok: true })]);
    const { client } = makeClient(pp.fetch);
    await expect(client.request("GET", "/v1/reporting/transactions")).resolves.toEqual({ ok: true });
    expect(pp.tokenCalls).toHaveLength(2);
  });

  it("caches the token, and concurrent first calls share one token request", async () => {
    const pp = fakePayPal([json(200, { n: 1 }), json(200, { n: 2 }), json(200, { n: 3 })]);
    const { client } = makeClient(pp.fetch);
    await Promise.all([client.request("GET", "/a"), client.request("GET", "/b")]);
    await client.request("GET", "/c");
    expect(pp.tokenCalls).toHaveLength(1);
  });

  it("fetches a new token 5 minutes before expiry", async () => {
    let now = 0;
    const pp = fakePayPal([json(200, {}), json(200, {}), json(200, {})], [tokenReply("tok-a", 3600), tokenReply("tok-b", 3600)]);
    const { client } = makeClient(pp.fetch, { now: () => now });
    await client.request("GET", "/a");
    now = (3600 - 301) * 1000;
    await client.request("GET", "/b");
    now = (3600 - 299) * 1000;
    await client.request("GET", "/c");
    expect(pp.calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer tok-a", "Bearer tok-a", "Bearer tok-b"]);
  });

  it("never puts the client secret anywhere but the token call's Basic header", async () => {
    const pp = fakePayPal([json(200, {})]);
    const { client } = makeClient(pp.fetch);
    await client.request("GET", "/a");
    expect(JSON.stringify(pp.calls)).not.toContain("secret");
    expect(pp.tokenCalls[0]!.headers["Authorization"]).toBe("Basic " + Buffer.from("id:secret").toString("base64"));
  });

  it("sends PayPal-Mock-Response as JSON for negative testing", async () => {
    const pp = fakePayPal([json(200, {})]);
    const { client } = makeClient(pp.fetch);
    await client.request("GET", "/v2/checkout/orders/O1", { mockCode: "INTERNAL_SERVER_ERROR" });
    expect(JSON.parse(pp.calls[0]!.headers["PayPal-Mock-Response"]!)).toEqual({ mock_application_codes: "INTERNAL_SERVER_ERROR" });
  });
});

describe("refundCapture", () => {
  it("always sends an explicit amount, the key, and representation", async () => {
    const pp = fakePayPal([created()]);
    const { client } = makeClient(pp.fetch);
    await refundCapture(client, { captureId: "3C679366HH908993F", amountCents: 4200, requestId: "pushover-refund-x", customId: "RR-1", note: "n" });
    const call = pp.calls[0]!;
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/payments/captures/3C679366HH908993F/refund");
    expect(call.headers["PayPal-Request-Id"]).toBe("pushover-refund-x");
    expect(call.headers["Prefer"]).toBe("return=representation");
    expect(JSON.parse(call.body!)).toEqual({ amount: { currency_code: "USD", value: "42.00" }, custom_id: "RR-1", note_to_payer: "n" });
  });

  it("refuses zero, negative and fractional cents before calling PayPal", async () => {
    const pp = fakePayPal([]);
    const { client } = makeClient(pp.fetch);
    for (const amountCents of [0, -1, 1.5]) {
      expect(() => refundCapture(client, { captureId: "C", amountCents, requestId: "k", customId: "c", note: "" })).toThrow();
    }
    expect(pp.fetch).not.toHaveBeenCalled();
  });

  it("rejects a custom_id over PayPal's 127 character limit", () => {
    const { client } = makeClient(fakePayPal([]).fetch);
    expect(() => refundCapture(client, { captureId: "C", amountCents: 1, requestId: "k", customId: "x".repeat(128), note: "" })).toThrow(/127/);
  });
});
