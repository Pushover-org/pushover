// Balances, Transaction Search and webhook signature checks. Field names follow the vendored
// specs (docs/paypal-specs/reporting_transactions_v1.json, notifications_webhooks_v1.json);
// behaviour follows what the sandbox did (docs/sandbox-findings.md, 2026-11-10).
import type { PayPalClient } from "./client.ts";
import { PayPalApiError } from "./errors.ts";
import { valueToCents } from "./money.ts";

export interface Balance {
  availableCents: number;
  totalCents: number;
  withheldCents: number;
  /** The balance is as of this time, not now: the sandbox showed it about two hours behind. */
  asOf: Date;
}

interface BalanceAmount {
  currency_code?: string;
  value: string;
}

/** GET /v1/reporting/balances for one currency. Throws if PayPal reports none in it. */
export async function getBalance(pp: PayPalClient, currency = "USD"): Promise<Balance> {
  const res = await pp.request<{
    balances?: { currency: string; total_balance?: BalanceAmount; available_balance?: BalanceAmount; withheld_balance?: BalanceAmount }[];
    as_of_time?: string;
    last_refresh_time?: string;
  }>("GET", `/v1/reporting/balances?currency_code=${encodeURIComponent(currency)}`);
  const b = res.balances?.find((x) => x.currency === currency);
  if (!b?.available_balance) throw new Error(`PayPal reported no ${currency} balance`);
  const asOf = res.as_of_time ?? res.last_refresh_time;
  if (!asOf) throw new Error("PayPal's balance has no as_of_time, so its age is unknown");
  return {
    availableCents: valueToCents(b.available_balance.value),
    totalCents: valueToCents(b.total_balance?.value ?? b.available_balance.value),
    withheldCents: b.withheld_balance ? valueToCents(b.withheld_balance.value) : 0,
    asOf: new Date(asOf),
  };
}

export type HistoryLookup =
  | { found: true; eventCode: string; status: string; amountCents: number; feeCents: number | null; lastRefreshed: Date | null }
  | { found: false; reason: "NOT_AVAILABLE_YET" | "NOT_IN_HISTORY"; lastRefreshed: Date | null };

const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** History amounts are signed from the account's side: a payout sent is "-1.00". */
const signedCents = (v: string) => (v.startsWith("-") ? -valueToCents(v.slice(1)) : valueToCents(v));

/**
 * Looks one transaction up in PayPal's own history (GET /v1/reporting/transactions), in a window
 * around when it happened. A window the history hasn't reached yet comes back 404 "Data for the
 * given start date is not available.", which is reported as NOT_AVAILABLE_YET, not as missing.
 */
export async function findInHistory(pp: PayPalClient, a: { transactionId: string; around: Date }): Promise<HistoryLookup> {
  const start = new Date(a.around.getTime() - 3_600_000);
  const end = new Date(Math.min(Date.now(), a.around.getTime() + 24 * 3_600_000));
  const q = `transaction_id=${encodeURIComponent(a.transactionId)}&start_date=${fmt(start)}&end_date=${fmt(end)}&fields=transaction_info&page_size=1`;
  try {
    const res = await pp.request<{ transaction_details?: { transaction_info: Record<string, unknown> }[]; last_refreshed_datetime?: string }>("GET", `/v1/reporting/transactions?${q}`);
    const lastRefreshed = res.last_refreshed_datetime ? new Date(res.last_refreshed_datetime) : null;
    const t = res.transaction_details?.map((d) => d.transaction_info).find((i) => i["transaction_id"] === a.transactionId);
    if (!t) return { found: false, reason: "NOT_IN_HISTORY", lastRefreshed };
    const amount = t["transaction_amount"] as BalanceAmount | undefined;
    const fee = t["fee_amount"] as BalanceAmount | undefined;
    return {
      found: true, eventCode: String(t["transaction_event_code"] ?? ""), status: String(t["transaction_status"] ?? ""),
      amountCents: amount ? signedCents(amount.value) : 0, feeCents: fee ? signedCents(fee.value) : null, lastRefreshed,
    };
  } catch (err) {
    if (err instanceof PayPalApiError && err.status === 404 && /not available/i.test(JSON.stringify(err.body))) {
      return { found: false, reason: "NOT_AVAILABLE_YET", lastRefreshed: null };
    }
    throw err;
  }
}

/** The PAYPAL-* headers of a webhook delivery, lower-cased as Node gives them. */
export interface WebhookHeaders {
  "paypal-auth-algo"?: string | null;
  "paypal-cert-url"?: string | null;
  "paypal-transmission-id"?: string | null;
  "paypal-transmission-sig"?: string | null;
  "paypal-transmission-time"?: string | null;
}

/**
 * POST /v1/notifications/verify-webhook-signature: PayPal says whether this delivery is really
 * its own, for our webhook. True only on verification_status SUCCESS; a missing header is false
 * without asking.
 */
export async function verifyWebhookSignature(pp: PayPalClient, a: { headers: WebhookHeaders; webhookId: string; event: unknown }): Promise<boolean> {
  const h = a.headers;
  const need = [h["paypal-auth-algo"], h["paypal-cert-url"], h["paypal-transmission-id"], h["paypal-transmission-sig"], h["paypal-transmission-time"]];
  if (need.some((v) => !v) || !a.webhookId) return false;
  // A check, not a money move; the client wants a key on every POST, and one per delivery is stable.
  const res = await pp.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    requestId: `verify-${h["paypal-transmission-id"]}`,
    body: {
      auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"], transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"], transmission_time: h["paypal-transmission-time"], webhook_id: a.webhookId, webhook_event: a.event,
    },
  });
  return res.verification_status === "SUCCESS";
}
