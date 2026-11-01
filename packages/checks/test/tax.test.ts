import { describe, expect, it } from "vitest";
import { checkTax, loadTaxTable, rangeFor } from "../src/tax.ts";
import { findings } from "./fixtures.ts";

const T = loadTaxTable();
const MARGIN = 2;
const receipt = (state: string, address: string, date: string, sub: number, tax: number) =>
  findings({ merchant_state: state as never, merchant_address: address, purchase_date: date, subtotal_cents: sub, tax_cents: tax, total_cents: sub + tax });

describe("tax table data", () => {
  it("every row cites an https source, and every range is the right way round", () => {
    for (const r of T.state_rows) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.min_pct).toBeLessThanOrEqual(r.max_pct);
      expect(r.from <= r.to).toBe(true);
    }
    for (const r of T.city_rows) expect(r.source_url).toMatch(/^https:\/\//);
  });
  it("covers every day of the class period in each corpus state, with no overlaps", () => {
    for (const st of ["CA", "CT", "FL", "MI", "NJ", "NY", "SC", "TX", "WA"]) {
      const rows = T.state_rows.filter((r) => r.state === st).sort((a, b) => (a.from < b.from ? -1 : 1));
      expect(rows[0]?.from, st).toBe("2015-01-01");
      expect(rows.at(-1)?.to, st).toBe("2019-12-31");
      for (let i = 1; i < rows.length; i++) {
        const next = new Date(`${rows[i - 1]?.to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expect(rows[i]?.from, st).toBe(next.toISOString().slice(0, 10));
      }
    }
  });
  it("no state outside the corpus: a gap must be UNKNOWN, not guessed", () => {
    expect(new Set(T.state_rows.map((r) => r.state)).size).toBe(9);
  });
});

describe("rates are the ones in force on the receipt's date", () => {
  it("Long Beach CA: 9.0% in 2016, 9.75% in early 2017, 10.25% in 2018", () => {
    expect(rangeFor(T, "CA", "2016-05-26", "Long Beach, CA")).toMatchObject({ min: 90000, max: 90000 });
    expect(rangeFor(T, "CA", "2017-02-01", "Long Beach, CA")).toMatchObject({ min: 97500, max: 97500 });
    expect(rangeFor(T, "CA", "2018-08-01", "Long Beach, CA")).toMatchObject({ min: 102500, max: 102500 });
  });
  it("NYC: 8.875% where Publication 718 (8/19) proves it; before that, the state range", () => {
    expect(rangeFor(T, "NY", "2019-09-01", "123 Broadway, New York, NY 10006")).toMatchObject({ min: 88750, max: 88750 });
    expect(rangeFor(T, "NY", "2017-03-05", "123 Broadway, New York, NY 10006")).toMatchObject({ min: 40000, max: 88750, scope: "NY" });
  });
  it("New Jersey's rate falls: 7% (2016), 6.875% (2017), 6.625% (2018)", () => {
    expect(rangeFor(T, "NJ", "2016-06-01", null)?.max).toBe(70000);
    expect(rangeFor(T, "NJ", "2017-06-01", null)?.max).toBe(68750);
    expect(rangeFor(T, "NJ", "2018-06-01", null)?.max).toBe(66250);
  });
  it("Connecticut meals go to 7.35% on 2019-10-01", () => {
    expect(rangeFor(T, "CT", "2019-09-30", null)).toMatchObject({ min: 63500, max: 63500 });
    expect(rangeFor(T, "CT", "2019-10-01", null)).toMatchObject({ min: 73500, max: 73500 });
  });
  it("an unknown city uses the state's range", () => expect(rangeFor(T, "CA", "2016-05-26", "Nowhere, CA")).toMatchObject({ min: 75000, max: 100000, scope: "CA" }));
  it("a city name must be a whole word", () => expect(rangeFor(T, "CA", "2016-05-26", "Newarkville, CA")?.scope).toBe("CA"));
  it("a date or state with no row gives nothing", () => {
    expect(rangeFor(T, "CA", "2014-12-01", null)).toBeNull();
    expect(rangeFor(T, "OH", "2016-05-26", null)).toBeNull();
  });
});

describe("C4 on the real receipts", () => {
  it.each([
    ["1000 Long Beach: $4.68 where 9.0% gives $4.67 (rounding)", "CA", "Long Beach, CA 90804", "2016-05-26", 5190, 468],
    ["1014 Bellflower 2019, 9.5%", "CA", "Bellflower, CA 90706", "2019-02-23", 4432, 421],
    ["1048 Santa Monica 2018, 10.25%", "CA", "Santa Monica, CA 90404", "2018-11-01", 8295, 850],
    ["1090 Lodi 2017, 7.75%", "CA", "Lodi, CA 95240", "2017-05-25", 3031, 235],
    ["1105 Hartford CT 2018, 6.35%", "CT", "Hartford, CT 06114", "2018-02-17", 2150, 137],
    ["1163 Bayside NY 2017, 8.875%", "NY", "Bayside, NY 11360", "2017-03-05", 3795, 337],
    ["1187 Denton TX 2019, 8.25%", "TX", "Denton, TX 76205", "2019-06-16", 4654, 384],
    ["1069 Rockwood MI 2019, 6%", "MI", "Rockwood, MI 48173", "2019-08-12", 1028, 62],
    ["1148 Walterboro SC 2018, 10%", "SC", "Walterboro, SC 29488", "2018-06-22", 1188, 119],
  ])("%s → PASS", (_n, st, addr, date, sub, tax) => {
    expect(checkTax(receipt(st, addr, date, sub, tax), T, MARGIN).result).toBe("PASS");
  });
  it("1084 Hoboken NJ 2018 charged 7.00% (state rate 6.625%): a person looks, no denial", () => {
    expect(checkTax(receipt("NJ", "Hoboken, NJ 07030", "2018-07-01", 11775, 824), T, MARGIN).result).toBe("UNKNOWN");
  });
  it("1099 San Jose 2017 charged 10.91% (city rate 9.25%): a person looks, no denial", () => {
    expect(checkTax(receipt("CA", "San Jose, CA 95113", "2017-12-29", 5005, 546), T, MARGIN).result).toBe("UNKNOWN");
  });
});

describe("C4 outcomes", () => {
  const at = (tax: number) => receipt("TX", "Denton, TX", "2019-06-16", 10_000, tax);
  it("far above the state's highest rate fails", () => expect(checkTax(at(1400), T, MARGIN).result).toBe("FAIL"));
  it("far below the state's lowest rate fails", () => expect(checkTax(at(100), T, MARGIN).result).toBe("FAIL"));
  it("just outside, within the margin, is UNKNOWN", () => {
    expect(checkTax(at(900), T, MARGIN).result).toBe("UNKNOWN");
    expect(checkTax(at(500), T, MARGIN).result).toBe("UNKNOWN");
  });
  it("zero tax is UNKNOWN: hot coffee to go is exempt in California", () => expect(checkTax(at(0), T, MARGIN).result).toBe("UNKNOWN"));
  it("a state with no rate in the table is UNKNOWN", () =>
    expect(checkTax(receipt("OH", "Akron, OH", "2019-06-16", 1000, 70), T, MARGIN).result).toBe("UNKNOWN"));
  it("a date with no rate in the table is UNKNOWN", () =>
    expect(checkTax(receipt("CA", "Long Beach, CA", "2014-12-01", 1000, 90), T, MARGIN).result).toBe("UNKNOWN"));
  it("missing tax or date is UNKNOWN", () => {
    expect(checkTax(findings({ tax_cents: null }), T, MARGIN).result).toBe("UNKNOWN");
    expect(checkTax(findings({ purchase_date: null }), T, MARGIN).result).toBe("UNKNOWN");
  });
  it("uses the lines when no subtotal is printed", () => expect(checkTax(findings({ subtotal_cents: null }), T, MARGIN).result).toBe("PASS"));
});
