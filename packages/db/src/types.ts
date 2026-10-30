export type Merchant = "GUARDED" | "BASELINE";

export interface Customer {
  merchant: Merchant;
  id: string;
  displayName: string;
  email: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  /** Per unit. */
  taxCents: number;
}

export interface Order {
  merchant: Merchant;
  id: string;
  customerId: string | null;
  paypalOrderId: string;
  totalCents: number;
  deliveredAt: Date | null;
  notes: string | null;
  scenarioId: string | null;
  items: OrderItem[];
  capture: { id: string; amountCents: number; paypalStatus: string; state: "POOL" | "ASSIGNED" | "RETIRED" } | null;
}

export interface Policy {
  version: number;
  windowDays: number;
  humanThresholdCents: number;
  dailyCapCents: number;
  velocityMax: number;
  velocityWindowDays: number;
}
