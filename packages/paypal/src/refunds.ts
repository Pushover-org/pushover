import type { PayPalClient } from "./client.ts";
import { PayPalRefundMismatchError } from "./errors.ts";
import { centsToValue } from "./money.ts";
import type { Capture, Refund } from "./types.ts";

/** refund_request.custom_id and note_to_payer limits (payments_payment_v2.json). */
const CUSTOM_ID_MAX = 127;
const NOTE_MAX = 255;

export interface RefundCaptureArgs {
  captureId: string;
  amountCents: number;
  /** Derived from the refund intent; identical on every retry of that intent. */
  requestId: string;
  customId: string;
  note: string;
  mockCode?: string;
}

/**
 * The one money-moving call. Always sends an explicit amount: an empty body
 * refunds "captured minus previous refunds", which is the baseline's failure mode.
 * The returned refund must be for the requested amount (see PayPalRefundMismatchError).
 */
export async function refundCapture(pp: PayPalClient, a: RefundCaptureArgs): Promise<Refund> {
  if (a.customId.length > CUSTOM_ID_MAX) throw new Error(`custom_id longer than ${CUSTOM_ID_MAX}`);
  const value = centsToValue(a.amountCents);
  const refund = await pp.request<Refund>("POST", `/v2/payments/captures/${encodeURIComponent(a.captureId)}/refund`, {
    requestId: a.requestId,
    prefer: "return=representation",
    ...(a.mockCode === undefined ? {} : { mockCode: a.mockCode }),
    body: {
      amount: { currency_code: "USD", value },
      custom_id: a.customId,
      note_to_payer: a.note.slice(0, NOTE_MAX),
    },
  });
  if (refund.amount?.value !== value) {
    throw new PayPalRefundMismatchError(a.requestId, value, { id: refund.id, status: refund.status, value: refund.amount?.value });
  }
  return refund;
}

export function getRefund(pp: PayPalClient, refundId: string): Promise<Refund> {
  return pp.request<Refund>("GET", `/v2/payments/refunds/${encodeURIComponent(refundId)}`);
}

export function getCapture(pp: PayPalClient, captureId: string): Promise<Capture> {
  return pp.request<Capture>("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
}
