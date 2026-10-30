import { describe, expect, it } from "vitest";
import { centsToValue, valueToCents } from "../src/money.ts";

describe("money", () => {
  it.each([
    [1, "0.01"],
    [640, "6.40"],
    [8640, "86.40"],
    [31000, "310.00"],
  ])("centsToValue(%i) = %s", (cents, value) => {
    expect(centsToValue(cents)).toBe(value);
    expect(valueToCents(value)).toBe(cents);
  });

  it("parses one decimal and no decimals", () => {
    expect(valueToCents("86.4")).toBe(8640);
    expect(valueToCents("86")).toBe(8600);
  });

  it.each(["", "-1.00", "1.234", "1,00", "1e3", " 1.00", "abc"])("rejects %j", (v) => {
    expect(() => valueToCents(v)).toThrow();
  });

  it.each([0, -5, 1.5, Number.NaN])("centsToValue rejects %s", (c) => {
    expect(() => centsToValue(c)).toThrow();
  });
});
