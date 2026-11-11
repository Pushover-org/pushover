// Reads only, moves no money: the balance check (P34) and the history check (P39) through PayPal's
// own Server SDK (plan item P57), against the real sandbox with the guarded (settlement fund) app.
// The payout looked up was sent on 2026-10-31 (docs/sandbox-findings.md; test/reporting.test.ts
// holds the same transaction as recorded then).
import { describe, expect, it } from "vitest";
import { limiterFromEnv, paypalClientFromEnv } from "../src/env.ts";
import { findInHistory, getBalance } from "../src/reporting.ts";

const hasCreds = Boolean(process.env["PAYPAL_GUARDED_CLIENT_ID"] && process.env["PAYPAL_GUARDED_CLIENT_SECRET"]);

describe.skipIf(!hasCreds)("balances and Transaction Search through PayPal's Server SDK, in the sandbox", () => {
  const pp = paypalClientFromEnv("guarded", limiterFromEnv());

  it("reads the fund's USD balance and how old it is", async () => {
    const b = await getBalance(pp);
    console.log("balance", JSON.stringify({ availableCents: b.availableCents, totalCents: b.totalCents, withheldCents: b.withheldCents, asOf: b.asOf }));
    expect(b.availableCents).toBeGreaterThan(0);
    expect(b.asOf.getTime()).toBeLessThan(Date.now());
  });

  it("finds a sandbox payout in PayPal's history, as T0001 with its fee", async () => {
    const r = await findInHistory(pp, { transactionId: "4LF69280FT181700C", around: new Date("2026-10-31T14:03:25Z") });
    console.log("history", JSON.stringify(r));
    expect(r).toMatchObject({ found: true, eventCode: "T0001", status: "S", amountCents: -100, feeCents: -25 });
  });

  it("tells a transaction PayPal doesn't have apart from an error", async () => {
    const r = await findInHistory(pp, { transactionId: "0AAAAAAAAAAAAAAAA", around: new Date("2026-10-31T14:03:25Z") });
    console.log("missing", JSON.stringify(r));
    expect(r).toMatchObject({ found: false, reason: "NOT_IN_HISTORY" });
  });
});
