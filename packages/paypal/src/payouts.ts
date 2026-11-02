// PayPal Payouts (batch payouts to many receivers). Field names and limits come from
// docs/paypal-specs/payments_payouts_batch_v1.json. Note that Payouts money is
// { currency, value }, not the { currency_code, value } that Orders and Refunds use.
import type { PayPalClient } from "./client.ts";
import { PayPalApiError } from "./errors.ts";
import { centsToValue } from "./money.ts";

/** `transaction_enum`. */
export type PayoutItemStatus =
  | "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED" | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";

/** `batch_enum`. */
export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";

export interface PayoutMoney {
  currency: string;
  value: string;
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: PayoutItemStatus;
  payout_item_fee?: PayoutMoney;
  payout_batch_id: string;
  sender_batch_id?: string;
  payout_item: {
    recipient_type?: string;
    amount: PayoutMoney;
    note?: string;
    receiver: string;
    sender_item_id?: string;
    recipient_wallet?: string;
  };
  time_processed?: string;
  errors?: { name?: string; message?: string; debug_id?: string };
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: PayoutBatchStatus;
  time_created?: string;
  time_completed?: string;
  time_closed?: string;
  sender_batch_header: { sender_batch_id?: string; email_subject?: string; email_message?: string };
  amount?: PayoutMoney;
  fees?: PayoutMoney;
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items: PayoutItem[];
}

/**
 * Who receives an item: an email, or a PayPal account by its payer ID (recipient_type PAYPAL_ID,
 * verified in the sandbox 2026-11-02: docs/sandbox-findings.md → Log in with PayPal).
 */
export type PayoutReceiver = { receiverEmail: string; receiverPayerId?: never } | { receiverPayerId: string; receiverEmail?: never };

/** PayPal's payer ID format, ppaas_payer_id_v3 (docs/paypal-specs/checkout_orders_v2.json). */
export const PAYER_ID = /^[2-9A-HJ-NP-Z]{13}$/;

export type PayoutItemInput = PayoutReceiver & {
  /** Our claim's ID; unique within the batch. */
  senderItemId: string;
  cents: number;
  note?: string;
  /** "PAYPAL" or "VENMO" (`recipient_wallet_enum`). Venmo receivers are not yet tried in sandbox. */
  recipientWallet?: "PAYPAL" | "VENMO";
};

export interface CreatePayoutBatchArgs {
  /** Also the PayPal-Request-Id. PayPal rejects a sender_batch_id reused within 30 days. */
  senderBatchId: string;
  emailSubject: string;
  emailMessage: string;
  items: PayoutItemInput[];
}

/** Limits from the spec. */
const MAX_ITEMS = 15_000;
const LIMITS = { senderBatchId: 256, emailSubject: 255, emailMessage: 1000, receiver: 127, senderItemId: 63, note: 4000 };
const ID = /^[A-Za-z0-9._-]+$/;

/**
 * PayPal answered the create call with a batch whose sender_batch_id is not the one we sent.
 * A reused PayPal-Request-Id returns the original response and ignores the new body (D1-4),
 * so this means a key was reused for a different batch.
 */
export class PayoutBatchMismatchError extends Error {
  readonly sent: string;
  readonly received: string | undefined;
  readonly payoutBatchId: string;
  constructor(sent: string, received: string | undefined, payoutBatchId: string) {
    super(`Payout batch ${payoutBatchId} has sender_batch_id ${received ?? "none"}, sent ${sent}`);
    this.name = "PayoutBatchMismatchError";
    this.sent = sent;
    this.received = received;
    this.payoutBatchId = payoutBatchId;
  }
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`payout batch: ${message}`);
}

export function buildPayoutRequest(a: CreatePayoutBatchArgs): unknown {
  check(ID.test(a.senderBatchId) && a.senderBatchId.length <= LIMITS.senderBatchId, `bad sender_batch_id ${JSON.stringify(a.senderBatchId)}`);
  check(a.emailSubject.length <= LIMITS.emailSubject && a.emailMessage.length <= LIMITS.emailMessage, "email subject or message too long");
  check(a.items.length >= 1 && a.items.length <= MAX_ITEMS, `items must be 1..${MAX_ITEMS}`);
  const seen = new Set<string>();
  const items = a.items.map((i) => {
    check(ID.test(i.senderItemId) && i.senderItemId.length <= LIMITS.senderItemId, `bad sender_item_id ${JSON.stringify(i.senderItemId)}`);
    check(!seen.has(i.senderItemId), `duplicate sender_item_id ${i.senderItemId}`);
    seen.add(i.senderItemId);
    const byId = i.receiverPayerId !== undefined;
    if (byId) check(PAYER_ID.test(i.receiverPayerId), `bad payer ID for ${i.senderItemId}`);
    else check(i.receiverEmail.includes("@") && i.receiverEmail.length <= LIMITS.receiver, `bad receiver for ${i.senderItemId}`);
    check((i.note ?? "").length <= LIMITS.note, `note too long for ${i.senderItemId}`);
    return {
      recipient_type: byId ? "PAYPAL_ID" : "EMAIL",
      amount: { currency: "USD", value: centsToValue(i.cents) },
      receiver: byId ? i.receiverPayerId : i.receiverEmail,
      sender_item_id: i.senderItemId,
      ...(i.note === undefined ? {} : { note: i.note }),
      ...(i.recipientWallet === undefined ? {} : { recipient_wallet: i.recipientWallet }),
    };
  });
  return {
    sender_batch_header: { sender_batch_id: a.senderBatchId, email_subject: a.emailSubject, email_message: a.emailMessage },
    items,
  };
}

/**
 * The batch ID PayPal links to when it refuses a reused sender_batch_id. Observed in sandbox
 * 2026-11-01: 400 USER_BUSINESS_ERROR, details[0].field "SENDER_BATCH_ID", with a "self" link to
 * the original batch, even when the PayPal-Request-Id was the same (docs/sandbox-findings.md).
 */
export function existingBatchIdOf(err: unknown): string | undefined {
  if (!(err instanceof PayPalApiError) || err.status !== 400) return undefined;
  const details = (err.body as { details?: { field?: string; link?: { href?: string; rel?: string }[] }[] } | undefined)?.details ?? [];
  for (const d of details) {
    if (d.field !== "SENDER_BATCH_ID") continue;
    const href = d.link?.find((l) => l.rel === "self")?.href;
    const m = href ? /\/v1\/payments\/payouts\/([A-Za-z0-9]+)$/.exec(href) : null;
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export interface CreatePayoutBatchResult {
  header: PayoutBatchHeader;
  /** True when PayPal already had a batch with this sender_batch_id; nothing new was sent. */
  duplicate: boolean;
}

/**
 * POST /v1/payments/payouts. Returns the batch header (status is usually PENDING); read the
 * batch afterwards for item statuses.
 *
 * Safe to retry. A 5xx or timeout surfaces as PayPalUnknownOutcomeError, and the spec says
 * retrying with the same sender_batch_id is safe. A retry that PayPal refuses because the batch
 * already exists returns that original batch with `duplicate: true`: it is never reported as a
 * failure, because the money may well have gone out.
 */
export async function createPayoutBatch(pp: PayPalClient, a: CreatePayoutBatchArgs): Promise<CreatePayoutBatchResult> {
  const body = buildPayoutRequest(a);
  let header: PayoutBatchHeader;
  let duplicate = false;
  try {
    const res = await pp.request<{ batch_header: PayoutBatchHeader }>("POST", "/v1/payments/payouts", { requestId: a.senderBatchId, body });
    header = res.batch_header;
  } catch (err) {
    const existing = existingBatchIdOf(err);
    if (existing === undefined) throw err;
    const res = await pp.request<{ batch_header: PayoutBatchHeader }>("GET", `/v1/payments/payouts/${encodeURIComponent(existing)}?page=1&page_size=1`);
    header = res.batch_header;
    duplicate = true;
  }
  if (header.sender_batch_header.sender_batch_id !== a.senderBatchId) {
    throw new PayoutBatchMismatchError(a.senderBatchId, header.sender_batch_header.sender_batch_id, header.payout_batch_id);
  }
  return { header, duplicate };
}

/** GET /v1/payments/payouts/{id}, every page. */
export async function getPayoutBatch(pp: PayPalClient, batchId: string, opt: { pageSize?: number } = {}): Promise<PayoutBatch> {
  const pageSize = opt.pageSize ?? 1000;
  check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 1000, "page_size must be 1..1000");
  const items: PayoutItem[] = [];
  let header: PayoutBatchHeader | undefined;
  for (let page = 1; ; page++) {
    const res = await pp.request<{ batch_header: PayoutBatchHeader; items?: PayoutItem[]; total_pages?: number }>(
      "GET",
      `/v1/payments/payouts/${encodeURIComponent(batchId)}?page=${page}&page_size=${pageSize}&total_required=true`,
    );
    header ??= res.batch_header;
    items.push(...(res.items ?? []));
    if (res.total_pages === undefined) throw new Error(`payout batch ${batchId}: total_pages missing, cannot tell whether all items were read`);
    if (page >= res.total_pages) break;
  }
  return { batch_header: header, items };
}

export function getPayoutItem(pp: PayPalClient, itemId: string): Promise<PayoutItem> {
  return pp.request<PayoutItem>("GET", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
}

/**
 * Cancels an UNCLAIMED item (money returns to the sender). The sandbox has answered 500 here
 * (docs/sandbox-findings.md); that arrives as PayPalUnknownOutcomeError, so read the item again
 * before believing either outcome.
 */
export function cancelPayoutItem(pp: PayPalClient, itemId: string): Promise<PayoutItem> {
  return pp.request<PayoutItem>("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`, {
    requestId: `cancel-${itemId}`,
    body: {},
  });
}

/** What an item's status means for the money. */
export type PayoutItemOutcome = "PAID" | "UNCLAIMED" | "RETURNED" | "FAILED" | "IN_FLIGHT" | "UNVERIFIED";

/**
 * The spec lists nine statuses but does not describe them. SUCCESS, UNCLAIMED and RETURNED are
 * observed in sandbox; FAILED is taken at its word. PENDING, ONHOLD and BLOCKED are not
 * settled. REFUNDED and REVERSED are undocumented, so they are UNVERIFIED: never counted as
 * paid or as returned until someone confirms what happened.
 */
export function payoutItemOutcome(status: PayoutItemStatus | undefined): PayoutItemOutcome {
  switch (status) {
    case "SUCCESS":
      return "PAID";
    case "UNCLAIMED":
      return "UNCLAIMED";
    case "RETURNED":
      return "RETURNED";
    case "FAILED":
      return "FAILED";
    case "PENDING":
    case "ONHOLD":
    case "BLOCKED":
      return "IN_FLIGHT";
    case "REFUNDED":
    case "REVERSED":
    case undefined:
      return "UNVERIFIED";
  }
}
