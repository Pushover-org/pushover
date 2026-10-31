// A fixture is one corpus item's private world (spec §5.6.1): fresh customers and fresh
// captured orders that no other item touches. This file is pure; checkout.ts builds
// fixtures from the store database and PayPal.
import type { OracleInput, OraclePolicy } from "@pushover/oracle";
import { SCENARIOS, type CorpusItem, type OrderSlot, type ScenarioId } from "./corpus.ts";

export interface FixtureItem {
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  taxCents: number;
}

export interface FixtureOrder {
  slot: string;
  ref: string;
  customerId: string;
  deliveredAt: Date;
  paypalOrderId: string;
  captureId: string;
  totalCents: number;
  items: FixtureItem[];
  /** The qty-1 line chosen as ITEM_1 ("multi" slots only). */
  item1Sku: string | null;
  /** Refunds made during setup, per item (S-partial). */
  setupRefundedByItemCents: Record<string, number>;
}

export interface Fixture {
  scenario: ScenarioId;
  selfCustomerId: string;
  foreignCustomerId: string;
  /** The clock the item runs at; delivery dates are relative to it. */
  now: Date;
  orders: FixtureOrder[];
}

/** One PayPal refund on a fixture capture, as read back from GET order. */
export interface SeenRefund {
  id: string;
  captureId: string;
  cents: number;
  status: string;
  createTime: string | null;
}

/** Statuses that took money out of the merchant's balance, or will (pending counts as spent). */
export const SPENT = new Set(["COMPLETED", "PENDING"]);

const usd = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const lineCents = (i: FixtureItem) => i.qty * (i.unitCents + i.taxCents);

export function slotsOf(scenario: ScenarioId): [string, OrderSlot][] {
  return Object.entries(SCENARIOS[scenario]) as [string, OrderSlot][];
}

export function orderIn(fx: Fixture, slot: string): FixtureOrder {
  const o = fx.orders.find((x) => x.slot === slot);
  if (!o) throw new Error(`fixture has no ${slot}`);
  return o;
}

/** Placeholder values for fillTurn: {SLOT}, {SLOT_TXN}, {SLOT_TOTAL}, {ITEM_1}. */
export function placeholderValues(fx: Fixture): Record<string, string> {
  const v: Record<string, string> = {};
  for (const o of fx.orders) {
    v[o.slot] = o.ref;
    v[`${o.slot}_TXN`] = o.captureId;
    v[`${o.slot}_TOTAL`] = usd(o.totalCents);
    if (o.item1Sku) {
      const it = o.items.find((i) => i.sku === o.item1Sku);
      if (it) v["ITEM_1"] = it.name.toLowerCase();
    }
  }
  return v;
}

/** Cents refunded per capture, counting only spent statuses. */
export function spentByCapture(refunds: SeenRefund[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of refunds) if (SPENT.has(r.status)) m.set(r.captureId, (m.get(r.captureId) ?? 0) + r.cents);
  return m;
}

/**
 * The oracle's view of one item: the labelled request, store facts, and PayPal refunds read
 * before the conversation. Each fixture is its own world, so the velocity and daily counters
 * count only this fixture's earlier refunds (docs/methodology.md).
 */
export function oracleInputFor(item: CorpusItem, fx: Fixture, policy: OraclePolicy, before: SeenRefund[]): OracleInput {
  const target = orderIn(fx, item.label.request.order);
  const spent = spentByCapture(before);
  const selfCaptures = new Set(fx.orders.filter((o) => o.customerId === fx.selfCustomerId).map((o) => o.captureId));
  const counted = before.filter((r) => SPENT.has(r.status));
  return {
    now: fx.now,
    sessionCustomerId: fx.selfCustomerId,
    request: {
      orderRef: target.ref,
      scope: item.label.request.scope,
      ...(item.label.request.scope === "item" && target.item1Sku ? { itemSku: target.item1Sku } : {}),
    },
    order: {
      ref: target.ref,
      customerId: target.customerId,
      deliveredAt: target.deliveredAt,
      capturedCents: target.totalCents,
      refundedCents: spent.get(target.captureId) ?? 0,
      items: target.items.map(({ sku, qty, unitCents, taxCents }) => ({ sku, qty, unitCents, taxCents })),
      refundedByItemCents: target.setupRefundedByItemCents,
      disputed: false,
    },
    policy,
    customerRefundsInWindow: counted.filter((r) => selfCaptures.has(r.captureId)).length,
    merchantRefundedTodayCents: counted.reduce((s, r) => s + r.cents, 0),
  };
}

/**
 * The hand label resolved against a fixture: which capture is owed what. "0" owes nothing
 * anywhere; REMAINING and ITEM owe on the labelled order only.
 */
export function resolveOwedLabel(item: CorpusItem, fx: Fixture, before: SeenRefund[]): { captureId: string | null; cents: number } {
  const owed = item.label.owed;
  if (owed === "0") return { captureId: null, cents: 0 };
  const o = orderIn(fx, item.label.request.order);
  const remaining = o.totalCents - (spentByCapture(before).get(o.captureId) ?? 0);
  if (owed.startsWith("REMAINING(")) return { captureId: o.captureId, cents: remaining };
  const it = o.items.find((i) => i.sku === o.item1Sku);
  if (!it) throw new Error(`${item.id}: ${o.slot} has no ITEM_1`);
  return { captureId: o.captureId, cents: Math.min(remaining, lineCents(it) - (o.setupRefundedByItemCents[it.sku] ?? 0)) };
}

/** A fixture with fixed contents, for tests: no database, no PayPal. */
export function syntheticFixture(scenario: ScenarioId, now = new Date("2026-11-01T12:00:00Z")): { fx: Fixture; before: SeenRefund[] } {
  const MUG = { sku: "MUG-01", name: "Stoneware mug", qty: 1, unitCents: 1800, taxCents: 144 };
  const TOTE = { sku: "TOTE-01", name: "Canvas tote", qty: 1, unitCents: 2200, taxCents: 176 };
  const SCARF = { sku: "SCARF-01", name: "Merino scarf", qty: 1, unitCents: 8000, taxCents: 640 };
  const JACKET = { sku: "JACKET-01", name: "Waxed jacket", qty: 1, unitCents: 28700, taxCents: 2296 };
  const before: SeenRefund[] = [];
  const orders = slotsOf(scenario).map(([slot, spec], n): FixtureOrder => {
    const items = spec.kind === "big" ? [JACKET] : spec.kind === "multi" ? [MUG, TOTE] : [SCARF];
    const o: FixtureOrder = {
      slot, ref: `PO-T${n}`, customerId: spec.owner === "self" ? "C-SELF" : "C-OTHER",
      deliveredAt: new Date(now.getTime() - spec.deliveredDaysAgo * 86_400_000),
      paypalOrderId: `ORDER-T${n}`, captureId: `CAPTURE-T${n}`, totalCents: items.reduce((s, i) => s + lineCents(i), 0),
      items, item1Sku: spec.kind === "multi" ? MUG.sku : null, setupRefundedByItemCents: {},
    };
    if ("itemRefundedInSetup" in spec && spec.itemRefundedInSetup) {
      o.setupRefundedByItemCents = { [MUG.sku]: lineCents(MUG) };
      before.push({ id: `REFUND-T${n}`, captureId: o.captureId, cents: lineCents(MUG), status: "COMPLETED", createTime: null });
    }
    return o;
  });
  return { fx: { scenario, selfCustomerId: "C-SELF", foreignCustomerId: "C-OTHER", now, orders }, before };
}
