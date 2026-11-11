// Shapes recorded from the sandbox on 2026-11-10 (docs/sandbox-findings.md, scripts/money/probe-reporting.ts).
import { describe, expect, it } from "vitest";
import { findInHistory, getBalance, verifyWebhookSignature } from "../src/reporting.ts";
import { fakePayPal, json, makeClient } from "./fake.ts";

const NOT_AVAILABLE = { name: "INVALID_REQUEST", message: "Data for the given start date is not available.", debug_id: "ca582cfb51832", details: [], links: [] };
const T0001 = {
  transaction_id: "4LF69280FT181700C", paypal_reference_id: "8VL47486NW4847717", paypal_reference_id_type: "TXN", transaction_event_code: "T0001",
  transaction_status: "S", transaction_amount: { currency_code: "USD", value: "-1.00" }, fee_amount: { currency_code: "USD", value: "-0.25" },
  transaction_initiation_date: "2026-10-31T14:03:25Z",
};

describe("balances", () => {
  it("reads the available balance and how old it is", async () => {
    const pp = fakePayPal([json(200, {
      balances: [{ currency: "USD", total_balance: { currency_code: "USD", value: "6387.15" }, available_balance: { currency_code: "USD", value: "6387.15" }, withheld_balance: { currency_code: "USD", value: "0.00" } }],
      as_of_time: "2026-11-10T03:59:59Z", last_refresh_time: "2026-11-10T03:59:59Z",
    })]);
    const { client } = makeClient(pp.fetch);
    expect(await getBalance(client)).toEqual({ availableCents: 638715, totalCents: 638715, withheldCents: 0, asOf: new Date("2026-11-10T03:59:59Z") });
    const url = new URL(pp.calls[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/reporting/balances");
    expect(url.searchParams.get("currency_code")).toBe("USD");
  });
  it("refuses to guess when there's no balance in the currency or no age", async () => {
    const { client } = makeClient(fakePayPal([json(200, { balances: [], as_of_time: "2026-11-10T03:59:59Z" })]).fetch);
    await expect(getBalance(client)).rejects.toThrow("no USD balance");
    const one = { currency_code: "USD", value: "1.00" };
    const { client: c2 } = makeClient(fakePayPal([json(200, { balances: [{ currency: "USD", total_balance: one, available_balance: one }] })]).fetch);
    await expect(getBalance(c2)).rejects.toThrow("age is unknown");
  });
  it("refuses an answer that doesn't match PayPal's own schema, as the SDK checks it", async () => {
    const { client } = makeClient(fakePayPal([json(200, { balances: [{ currency: "USD", available_balance: { value: "1.00" } }], as_of_time: "2026-11-10T03:59:59Z" })]).fetch);
    await expect(getBalance(client)).rejects.toThrow("did not match the response schema");
  });
});

describe("Transaction Search", () => {
  const around = new Date("2026-10-31T14:03:00Z");
  it("finds a payout item by its transaction ID, as T0001 with its status and fee", async () => {
    const pp = fakePayPal([json(200, { transaction_details: [{ transaction_info: T0001 }], last_refreshed_datetime: "2026-11-10T03:59:59Z" })]);
    const { client } = makeClient(pp.fetch);
    expect(await findInHistory(client, { transactionId: "4LF69280FT181700C", around })).toEqual({
      found: true, eventCode: "T0001", status: "S", amountCents: -100, feeCents: -25, lastRefreshed: new Date("2026-11-10T03:59:59Z"),
    });
    const q = new URL(pp.calls[0]?.url ?? "").searchParams;
    expect([q.get("transaction_id"), q.get("start_date"), q.get("end_date"), q.get("fields"), q.get("page_size")]).toEqual([
      "4LF69280FT181700C", "2026-10-31T13:03:00Z", "2026-11-01T14:03:00Z", "transaction_info", "1",
    ]);
  });
  it("tells 'the history hasn't reached that day yet' apart from 'not there'", async () => {
    const { client } = makeClient(fakePayPal([json(404, NOT_AVAILABLE)]).fetch);
    expect(await findInHistory(client, { transactionId: "3Y757900L5145482A", around })).toEqual({ found: false, reason: "NOT_AVAILABLE_YET", lastRefreshed: null });
    const { client: c2 } = makeClient(fakePayPal([json(200, { transaction_details: [], last_refreshed_datetime: "2026-11-10T03:59:59Z" })]).fetch);
    expect(await findInHistory(c2, { transactionId: "3Y757900L5145482A", around })).toMatchObject({ found: false, reason: "NOT_IN_HISTORY" });
  });
  it("any other error is an error", async () => {
    const { client } = makeClient(fakePayPal([json(400, { name: "INVALID_REQUEST", message: "Invalid date range" })]).fetch);
    await expect(findInHistory(client, { transactionId: "X", around })).rejects.toThrow("INVALID_REQUEST");
  });
});

describe("webhook signatures", () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "paypal-transmission-id": "tx-1",
    "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-10T06:00:00Z",
  };
  const event = { id: "WH-1", event_type: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", resource: { payout_batch_id: "2HMAKHX862SAE" } };
  it("asks PayPal, sending every header and the event as received", async () => {
    const pp = fakePayPal([json(200, { verification_status: "SUCCESS" })]);
    const { client } = makeClient(pp.fetch);
    expect(await verifyWebhookSignature(client, { headers, webhookId: "WH-ID", event })).toBe(true);
    expect(JSON.parse(pp.calls[0]?.body ?? "{}")).toEqual({
      auth_algo: "SHA256withRSA", cert_url: headers["paypal-cert-url"], transmission_id: "tx-1", transmission_sig: "sig", transmission_time: "2026-11-10T06:00:00Z", webhook_id: "WH-ID", webhook_event: event,
    });
  });
  it("FAILURE is false, and a missing header or webhook ID is false without asking", async () => {
    const { client } = makeClient(fakePayPal([json(200, { verification_status: "FAILURE" })]).fetch);
    expect(await verifyWebhookSignature(client, { headers, webhookId: "WH-ID", event })).toBe(false);
    const never = fakePayPal([]);
    const { client: c2 } = makeClient(never.fetch);
    expect(await verifyWebhookSignature(c2, { headers: { ...headers, "paypal-transmission-sig": null }, webhookId: "WH-ID", event })).toBe(false);
    expect(await verifyWebhookSignature(c2, { headers, webhookId: "", event })).toBe(false);
    expect(never.calls).toHaveLength(0);
  });
});
