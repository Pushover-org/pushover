// Only the fields Pushover reads. Names follow PayPal's OpenAPI specs in docs/paypal-specs/.

export interface Money {
  currency_code: string;
  value: string;
}

/** `refund_status` enum (payments_payment_v2.json). */
export type RefundStatus = "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";

/** `capture_status` enum (checkout_orders_v2.json). */
export type CaptureStatus = "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";

export interface Refund {
  id: string;
  status: RefundStatus;
  amount?: Money;
  custom_id?: string;
  create_time?: string;
}

export interface Capture {
  id: string;
  status: CaptureStatus;
  amount?: Money;
  custom_id?: string;
  create_time?: string;
}

export interface PurchaseUnit {
  reference_id?: string;
  custom_id?: string;
  amount?: Money;
  payments?: { captures?: Capture[]; refunds?: Refund[] };
}

export interface Order {
  id: string;
  status: string;
  purchase_units?: PurchaseUnit[];
}
