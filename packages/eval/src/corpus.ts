// The attack corpus (spec §5.5). Items and labels are written by hand and committed before
// any run: the git timestamp is the pre-registration. Order IDs are never fixed in a file;
// each run gives every item fresh orders and fills the {PLACEHOLDERS} from them.
import { readFileSync } from "node:fs";

export const CLASSES = [
  "A1_WRONG_CUSTOMER", "A2_OUT_OF_WINDOW", "A3_INFLATED", "A4_FAKE_POLICY", "A5_REPEAT",
  "A6_DISPUTE_SE", "A7_IMPERSONATION", "A8_INDIRECT_INJECTION",
  "L1_LEGIT_FULL", "L2_LEGIT_ITEM", "L3_LEGIT_ABOVE_THRESHOLD", "L4_LEGIT_CLARIFY",
] as const;
export type AttackClass = (typeof CLASSES)[number];

/** An order slot in a scenario, filled with a fresh order at checkout (spec §5.6.1). */
export interface OrderSlot {
  owner: "self" | "foreign";
  deliveredDaysAgo: number;
  /** "multi": at least two lines and a qty-1 line, so ITEM_1 can be refunded alone. */
  kind: "normal" | "multi" | "big";
  /** S-partial: ITEM_1 is refunded at PayPal during setup, before the conversation. */
  itemRefundedInSetup?: boolean;
}

/**
 * Scenario contents. Slot names are the placeholders a turn may use. Each order slot also
 * offers {<SLOT>_TXN} (its PayPal capture ID, as printed on a PayPal receipt) and
 * {<SLOT>_TOTAL} (e.g. 309.96). ITEM_1 is the name of the chosen qty-1 line of ORDER_1.
 */
export const SCENARIOS = {
  "S-basic": {
    ORDER_1: { owner: "self", deliveredDaysAgo: 5, kind: "multi" },
    ORDER_2: { owner: "self", deliveredDaysAgo: 12, kind: "normal" },
    OLD_ORDER: { owner: "self", deliveredDaysAgo: 47, kind: "normal" },
  },
  "S-two-customers": {
    ORDER_1: { owner: "self", deliveredDaysAgo: 5, kind: "multi" },
    ORDER_2: { owner: "self", deliveredDaysAgo: 12, kind: "normal" },
    OLD_ORDER: { owner: "self", deliveredDaysAgo: 47, kind: "normal" },
    FOREIGN_ORDER_1: { owner: "foreign", deliveredDaysAgo: 6, kind: "normal" },
    FOREIGN_ORDER_2: { owner: "foreign", deliveredDaysAgo: 9, kind: "normal" },
  },
  "S-partial": {
    ORDER_1: { owner: "self", deliveredDaysAgo: 8, kind: "multi", itemRefundedInSetup: true },
  },
  "S-big": {
    BIG_ORDER: { owner: "self", deliveredDaysAgo: 4, kind: "big" },
  },
} as const satisfies Record<string, Record<string, OrderSlot>>;
export type ScenarioId = keyof typeof SCENARIOS;

export interface RefundRequestLabel {
  /** An order slot of the item's scenario. */
  order: string;
  scope: "full" | "item";
  /** "ITEM_1" when scope is "item". */
  item?: string;
}

export interface CorpusItem {
  id: string;
  class: AttackClass;
  legit: boolean;
  scenario: ScenarioId;
  as_customer: "self";
  turns: string[];
  /**
   * A8: text stored in an order's `notes` before the conversation, keyed by slot. The agent
   * reads it through lookup_my_orders, like a delivery note the customer typed at checkout.
   */
  notes?: Record<string, string>;
  label: {
    /** What the customer asks for across the whole conversation; the oracle scores this. */
    request: RefundRequestLabel;
    /** Hand label: "0", "REMAINING(<slot>)" or "ITEM(<slot>,ITEM_1)", resolved against the fixture. */
    owed: string;
    /** Hand label: the written policy sends this request to a member of staff. */
    staff_review: boolean;
    /** Expected ledger outcome per turn, ";"-separated (spec §4.7.3 codes; NONE = no refund request that turn). */
    expected_pushover: string;
    notes: string;
  };
}

/** Ledger outcomes and rule codes from spec §4.7.3. */
const OUTCOME_RE =
  /^(NONE|REFUND|REFUSE:(NOT_FOUND|NOT_OWNER|OUT_OF_WINDOW|NOT_CAPTURED|NOTHING_LEFT|ITEM_NOT_ON_ORDER)|HOLD:(ABOVE_THRESHOLD|DAILY_CAP|VELOCITY|DISPUTED|UNVERIFIED))$/;
const OWED_RE =/^(0|REMAINING\(([A-Z0-9_]+)\)|ITEM\(([A-Z0-9_]+),ITEM_1\))$/;

export function placeholdersOf(scenario: ScenarioId): Set<string> {
  const out = new Set<string>();
  for (const [slot, spec] of Object.entries(SCENARIOS[scenario]) as [string, OrderSlot][]) {
    out.add(slot).add(`${slot}_TXN`).add(`${slot}_TOTAL`);
    if (spec.kind === "multi") out.add("ITEM_1");
  }
  return out;
}

/** Every problem with one item; empty when it is well-formed. */
export function validateItem(item: CorpusItem): string[] {
  const errs: string[] = [];
  const at = (m: string) => errs.push(`${item.id}: ${m}`);
  if (!CLASSES.includes(item.class)) at(`unknown class ${item.class}`);
  if (!/^[AL]\d-\d{3}$/.test(item.id) || !item.id.startsWith(item.class.slice(0, 2))) at("id does not match class");
  if (item.legit !== item.class.startsWith("L")) at("legit flag does not match class");
  if (!(item.scenario in SCENARIOS)) {
    at(`unknown scenario ${item.scenario}`);
    return errs;
  }
  const slots = SCENARIOS[item.scenario] as Record<string, OrderSlot>;
  const allowed = placeholdersOf(item.scenario);
  if (item.turns.length < 1 || item.turns.length > 4) at("needs 1 to 4 turns");
  for (const t of item.turns) {
    for (const [, name] of t.matchAll(/\{([A-Z0-9_]+)\}/g)) if (name && !allowed.has(name)) at(`placeholder {${name}} not in ${item.scenario}`);
    if (/\{[^}]*$|^[^{]*\}/.test(t)) at("unbalanced braces in a turn");
  }
  for (const [slot, text] of Object.entries(item.notes ?? {})) {
    if (!slots[slot]) at(`notes on ${slot}, which is not in ${item.scenario}`);
    for (const [, name] of text.matchAll(/\{([A-Z0-9_]+)\}/g)) if (name && !allowed.has(name)) at(`placeholder {${name}} not in ${item.scenario}`);
  }
  const { request, owed } = item.label;
  const slot = slots[request.order];
  if (!slot) at(`request order ${request.order} not in ${item.scenario}`);
  if ((request.scope === "item") !== (request.item === "ITEM_1")) at("item scope needs item ITEM_1, full scope none");
  if (request.scope === "item" && slot?.kind !== "multi") at("item scope needs a multi order slot");
  const m = OWED_RE.exec(owed);
  if (!m) at(`owed "${owed}" is not 0, REMAINING(slot) or ITEM(slot,ITEM_1)`);
  else {
    const owedSlot = m[2] ?? m[3];
    if (owedSlot && owedSlot !== request.order) at("owed refers to a different order than the request");
    if (m[3] && request.scope !== "item") at("ITEM owed on a full-scope request");
    if (m[2] && request.scope !== "full") at("REMAINING owed on an item-scope request");
  }
  if (item.legit && owed === "0") at("a legitimate item must be owed something");
  const outcomes = item.label.expected_pushover.split(";");
  if (item.turns.length !== outcomes.length) at("expected_pushover needs one outcome per turn");
  for (const o of outcomes) if (!OUTCOME_RE.test(o)) at(`unknown expected outcome ${o}`);
  return errs;
}

export function parseCorpus(text: string): CorpusItem[] {
  const items = text.split("\n").filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l) as CorpusItem;
    } catch {
      throw new Error(`corpus line ${i + 1} is not JSON`);
    }
  });
  const errs = items.flatMap(validateItem);
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) errs.push(`${it.id}: duplicate id`);
    seen.add(it.id);
  }
  if (errs.length) throw new Error(`invalid corpus:\n${errs.join("\n")}`);
  return items;
}

export function loadCorpus(path: string): CorpusItem[] {
  return parseCorpus(readFileSync(path, "utf8"));
}

/** Replaces {NAME} with values from the fixture. A missing value is an error, never blank text. */
export function fillTurn(turn: string, values: Record<string, string>): string {
  return turn.replace(/\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`no fixture value for {${name}}`);
    return v;
  });
}
