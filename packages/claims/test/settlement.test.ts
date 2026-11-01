import { describe, expect, it } from "vitest";
import { parseSettlement, SettlementSchema } from "../src/settlement.ts";
import { demoSettlement } from "./fixtures.ts";

const base = () => structuredClone(demoSettlement()) as Record<string, unknown> & ReturnType<typeof demoSettlement>;

describe("settlement config", () => {
  it("accepts the fictional demo settlement", () => {
    expect(demoSettlement().name).toBe("Acme Restaurant Coffee Settlement (fictional demo)");
  });

  it.each<[string, (s: ReturnType<typeof base>) => unknown]>([
    ["a period that ends before it starts", (s) => ({ ...s, classPeriod: { start: "2026-09-30", end: "2026-01-01" } })],
    ["an impossible date", (s) => ({ ...s, classPeriod: { start: "2026-02-30", end: "2026-09-30" } })],
    ["a reserve as big as the fund", (s) => ({ ...s, adminReserveCents: s.fundCents })],
    ["fractional cents", (s) => ({ ...s, fundCents: 100.5 })],
    ["no products", (s) => ({ ...s, products: [] })],
    ["duplicate product ids", (s) => ({ ...s, products: [s.products[0], s.products[0]] })],
    ["a non-US state", (s) => ({ ...s, geography: { states: ["ON"] } })],
    ["a duplicate state", (s) => ({ ...s, geography: { states: ["CA", "CA"] } })],
    ["a demo name without (fictional demo)", (s) => ({ ...s, name: "Acme Restaurant Coffee Settlement" })],
    ["a demo cy-pres recipient without (demo)", (s) => ({ ...s, cyPres: { ...s.cyPres, name: "Clean Water Access Fund" } })],
    ["a bad cy-pres email", (s) => ({ ...s, cyPres: { ...s.cyPres, payoutEmail: "nope" } })],
    ["a no-proof amount above the proof maximum", (s) => ({ ...s, tiers: { ...s.tiers, noProof: { flatCents: 999_999 } } })],
    ["a currency other than USD", (s) => ({ ...s, currency: "EUR" })],
    ["an unknown field", (s) => ({ ...s, model_recommendation: "approve" })],
  ])("rejects %s", (_label, mutate) => {
    expect(SettlementSchema.safeParse(mutate(base())).success).toBe(false);
  });

  it("allows a real (non-demo) settlement name", () => {
    expect(() => parseSettlement({ ...base(), demo: false, name: "Some Settlement", cyPres: { ...base().cyPres, name: "Some Fund" } })).not.toThrow();
  });
});
