import { parseSettlement, type Findings } from "@pushover/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@pushover/checks";
import { getClaim, latestDecision, latestFindings, type Pool } from "@pushover/db";
import type { ExamineResult } from "@pushover/examiner";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, freshDatabase } from "../../db/test/testdb.ts";
import { ClaimRejectedError, decideClaim, fileClaim, reviewClaim, submitClaim, type Desk, type FileClaimInput } from "../src/index.ts";

const S = parseSettlement({
  id: "desk-test", name: "Desk Test Settlement (fictional demo)", demo: true, currency: "USD", fundCents: 200_000, adminReserveCents: 10_000,
  classPeriod: { start: "2015-01-01", end: "2019-12-31" }, products: [{ id: "restaurant-drink", name: "Non-alcoholic drink", description: "Any non-alcoholic drink bought at a restaurant" }],
  geography: { states: ["CA", "NY"] }, tiers: { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } }, cyPres: { name: "Clean Water Access Fund (demo)", payoutEmail: "po-merchant-baseline-3h8w@business.example.com" },
});

const findings = (over: Partial<Findings> = {}): Findings => ({
  document_type: "receipt", merchant_name: "Green Field", merchant_address: "5305 E Pacific Coast Hwy, Long Beach, CA 90804", merchant_state: "CA", purchase_date: "2016-05-26",
  line_items: [{ description: "Coffee", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }, { description: "Lunch", qty: 2, unit_cents: null, line_total_cents: 4590, matches_product_id: null }, { description: "Coke", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }],
  adjustments: [], subtotal_cents: 5190, tax_cents: 468, total_cents: 5658, visual_anomalies: [], declaration_consistent_with_evidence: "yes", declaration_issues: [], confidence: "high", model_recommendation: "approve",
  ...over,
});

/** A distinct image per seed, so C6 sees different photos. */
async function photo(seed: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(64 * 64);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i * 0.37 + seed * 11.3) * 127 + 128) & 255;
  return sharp(raw, { raw: { width: 64, height: 64, channels: 1 } }).jpeg().toBuffer();
}

let n = 0;
const claim = (over: Partial<FileClaimInput> = {}): FileClaimInput => {
  n++;
  return {
    tier: "no_proof", unitsClaimed: 1, name: `Person ${n}`, email: `p${n}@example.com`, addressLine: `${n} Main St`, city: "Long Beach", state: "CA", zip: "90804",
    declaration: `I bought drink number ${n} at a diner near my office in ${2015 + (n % 5)}.`, ip: `2001:db8:${n.toString(16)}::1`, image: null, paypal: null, ...over,
  };
};

describe.skipIf(!DATABASE_URL)("the claims desk on real Postgres", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let reads = 0;
  let reading: (() => ExamineResult) | null = null;
  const desk = (): Desk => ({
    pool, settlement: S, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: "desk-test",
    read: async () => {
      reads++;
      return reading ? reading() : { status: "OK", findings: findings(), model: "fake", stopReason: "end_turn", inputTokens: 0, outputTokens: 0, costUsd: 0, error: null };
    },
  });

  beforeAll(async () => {
    ({ pool, drop } = await freshDatabase());
    await pool.query("INSERT INTO settlements (id, name, config, fund_cents) VALUES ($1, $2, $3, $4)", [S.id, S.name, JSON.stringify(S), S.fundCents]);
  });
  afterAll(async () => drop?.());

  it("a no-proof claim is approved for the flat amount", async () => {
    const { claim: c, result } = await submitClaim(desk(), claim());
    expect(result?.decision).toMatchObject({ outcome: "APPROVE", entitlementCents: 1000 });
    expect((await getClaim(pool, c.id))?.status).toBe("APPROVE");
  });

  it("a proof claim is read once, checked, and paid for the drinks it shows", async () => {
    const before = reads;
    const { claim: c, result } = await submitClaim(desk(), claim({ tier: "proof", unitsClaimed: 5, image: await photo(1) }));
    expect(reads - before).toBe(1);
    expect(result?.decision).toMatchObject({ outcome: "APPROVE", units: 2, entitlementCents: 3000 });
    expect((await latestFindings(pool, c.id))?.status).toBe("OK");
  });

  it("the model's reading never decides: a receipt from outside the class period is denied even if the model says approve", async () => {
    reading = () => ({ status: "OK", findings: findings({ purchase_date: "2021-03-02", model_recommendation: "approve" }), model: "fake", stopReason: "end_turn", inputTokens: 0, outputTokens: 0, costUsd: 0, error: null });
    const { result } = await submitClaim(desk(), claim({ tier: "proof", image: await photo(2) }));
    reading = null;
    expect(result?.decision).toMatchObject({ outcome: "DENY", reason: "OUT_OF_PERIOD" });
  });

  it("a failed reading sends the claim to a person, never to approval", async () => {
    reading = () => ({ status: "REFUSED", findings: null, model: "fake", stopReason: "refusal", inputTokens: 0, outputTokens: 0, costUsd: 0, error: "refused" });
    const { claim: c, result } = await submitClaim(desk(), claim({ tier: "proof", image: await photo(3) }));
    reading = null;
    expect(result?.decision).toMatchObject({ outcome: "REVIEW", reason: "EXAMINER_REFUSED" });

    await reviewClaim(desk(), c.id, "APPROVE", "test-analyst");
    expect(await latestDecision(pool, c.id)).toMatchObject({ outcome: "APPROVE", decidedBy: "analyst:test-analyst", entitlementCents: 1500 });
  });

  it("the same photo filed again by someone else is denied", async () => {
    const img = await photo(4);
    await submitClaim(desk(), claim({ tier: "proof", image: img }));
    const { result } = await submitClaim(desk(), claim({ tier: "proof", image: img }));
    expect(result?.decision).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IMAGE" });
  });

  it("one PayPal account files one claim; the second is refused before it is stored", async () => {
    const paypal = { payerId: "QYR5Z8XDVJNXQ", verified: true, emailVerified: true };
    await fileClaim(desk(), claim({ paypal }));
    await expect(fileClaim(desk(), claim({ paypal }))).rejects.toBeInstanceOf(ClaimRejectedError);
  });

  it("refuses a proof claim without a photo, and a file that isn't an image", async () => {
    await expect(fileClaim(desk(), claim({ tier: "proof" }))).rejects.toThrow(/photo/);
    await expect(fileClaim(desk(), claim({ tier: "proof", image: new TextEncoder().encode("%PDF-1.7") }))).rejects.toThrow(/JPEG/);
  });

  it("a decided claim is not decided again", async () => {
    const { claim: c } = await submitClaim(desk(), claim());
    expect(await decideClaim(desk(), c.id)).toBeNull();
  });
});
