import { parseSettlement, type Findings } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { getClaim, latestDecision, latestFindings, type Pool } from "@proofofclaim/db";
import type { ExamineResult } from "@proofofclaim/examiner";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, freshDatabase } from "../../db/test/testdb.ts";
import { fakePayPal, json, makeClient } from "../../paypal/test/fake.ts";
import {
  analystFromToken, approveAndDistribute, cancelProposal, ClaimRejectedError, decideClaim, fileClaim, hashPassword, login, logout, MoneyRefusedError, openProposal, planDistribution,
  proposeDistribution, readBack, recheckApproved, reviewClaim, setAnalyst, submitClaim, verifyPassword, type Desk, type FileClaimInput,
} from "../src/index.ts";
import type { Analyst } from "@proofofclaim/db";

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

  describe("Distribute and read back", () => {
    it("re-checks approved claims: a bot cluster that formed later is pulled back to a person", async () => {
      const template = "I purchased several soft drinks at a restaurant during the settlement period and I request my payment under penalty of perjury.";
      const early = await submitClaim(desk(), claim({ declaration: `${template} Thank you.` }));
      expect(early.result?.decision.outcome).toBe("APPROVE");
      for (let i = 0; i < 4; i++) await fileClaim(desk(), claim({ declaration: `${template} Regards ${i}.` }));
      const moved = await recheckApproved(desk());
      expect(moved).toContainEqual({ claimId: early.claim.id, outcome: "REVIEW", reason: "TEMPLATE_CLUSTER" });
      expect((await getClaim(pool, early.claim.id))?.status).toBe("REVIEW");
    });

    let ana: Analyst;
    let lee: Analyst;
    let sol: Analyst;
    const sendsPB1 = () => fakePayPal([(call) => {
      const body = JSON.parse(call.body ?? "{}") as { sender_batch_header: { sender_batch_id: string } };
      return json(201, { batch_header: { payout_batch_id: "PB1", batch_status: "PENDING", sender_batch_header: body.sender_batch_header } });
    }]);

    it("money needs two people: a proposer, then a different supervisor", async () => {
      ana = await setAnalyst(pool, { email: "Ana@Example.com", name: "Ana", role: "analyst", password: "correct horse battery" }, "test");
      lee = await setAnalyst(pool, { email: "lee@example.com", name: "Lee", role: "analyst", password: "correct horse battery" }, "test");
      sol = await setAnalyst(pool, { email: "sol@example.com", name: "Sol", role: "supervisor", password: "correct horse battery" }, "test");
      expect(ana.email).toBe("ana@example.com");
      const { proposal } = await proposeDistribution(desk(), ana, { capCents: 5000 });
      expect(proposal).toMatchObject({ status: "PROPOSED", proposedBy: { email: "ana@example.com" } });
      const never = fakePayPal([]);
      const { client } = makeClient(never.fetch);
      await expect(approveAndDistribute(desk(), client, ana, proposal.id, { capCents: 5000 })).rejects.toThrow("you proposed this one");
      await expect(approveAndDistribute(desk(), client, lee, proposal.id, { capCents: 5000 })).rejects.toThrow("Only a supervisor");
      expect(never.calls).toHaveLength(0);
      expect((await openProposal(pool, S.id, "CLAIMS"))?.id).toBe(proposal.id);
    }, 60_000);

    it("if claims change between proposal and approval, nothing is sent and the proposal is superseded", async () => {
      const open = await openProposal(pool, S.id, "CLAIMS");
      await submitClaim(desk(), claim({ declaration: "A late claim: I had a lemonade with dinner at a cafe in Fresno in 2018." }));
      const never = fakePayPal([]);
      const { client } = makeClient(never.fetch);
      await expect(approveAndDistribute(desk(), client, sol, open?.id ?? -1, { capCents: 5000 })).rejects.toThrow(MoneyRefusedError);
      expect(never.calls).toHaveLength(0);
      expect(await openProposal(pool, S.id, "CLAIMS")).toBeNull();
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM payout_batches");
      expect(rows[0].n).toBe(0);
    });

    it("the proposer can withdraw their proposal; another analyst can't", async () => {
      const { proposal } = await proposeDistribution(desk(), ana, { capCents: 5000 });
      await expect(cancelProposal(desk(), lee, proposal.id)).rejects.toThrow("Only the person who proposed it");
      await cancelProposal(desk(), ana, proposal.id);
      expect(await openProposal(pool, S.id, "CLAIMS")).toBeNull();
    });

    it("approved by a second person, the batch is written before PayPal is called and names both people", async () => {
      const plan = await planDistribution(desk(), { capCents: 5000 });
      expect(plan.fundCents).toBe(5000);
      expect(plan.payees.find((p) => p.payerId)).toBeUndefined(); // the one PayPal-account claim above is still unread, not approved
      const { proposal } = await proposeDistribution(desk(), ana, { capCents: 5000 });
      const pp = sendsPB1();
      const { client } = makeClient(pp.fetch);
      const out = await approveAndDistribute(desk(), client, sol, proposal.id, { capCents: 5000 });
      expect(pp.calls).toHaveLength(1);
      expect(out.batches).toHaveLength(1);
      expect(out.batches[0]).toMatchObject({ paypalBatchId: "PB1", status: "PENDING", duplicate: false });
      expect(out.batches[0]?.cents).toBe(proposal.totalCents);
      expect(out.batches[0]?.cents).toBeLessThanOrEqual(5000);
      const { rows: b } = await pool.query("SELECT proposal_id FROM payout_batches");
      expect(b).toEqual([{ proposal_id: String(proposal.id) }]);
      const { rows } = await pool.query("SELECT DISTINCT status FROM claims WHERE id IN (SELECT claim_id FROM payout_items)");
      expect(rows.map((r) => r.status)).toEqual(["SCHEDULED"]);
      const { rows: audit } = await pool.query("SELECT actor, detail FROM audit_log WHERE action = 'distribute'");
      expect(audit).toEqual([{ actor: "analyst:sol@example.com", detail: expect.objectContaining({ proposed_by: "ana@example.com", approved_by: "sol@example.com", proposal_id: proposal.id }) }]);
      await expect(approveAndDistribute(desk(), client, sol, proposal.id, { capCents: 5000 })).rejects.toThrow("no longer open");
    });

    it("reads every item back and moves each claim to what PayPal reports", async () => {
      const { rows: items } = await pool.query<{ batch_id: string; sender_item_id: string }>("SELECT batch_id, sender_item_id FROM payout_items ORDER BY id");
      const batchId = Number(items[0]?.batch_id);
      const statuses = ["SUCCESS", "UNCLAIMED", "FAILED"];
      const pp = fakePayPal([json(200, {
        batch_header: { payout_batch_id: "PB1", batch_status: "SUCCESS", fees: { currency: "USD", value: "0.75" }, sender_batch_header: {} },
        items: items.map((it, i) => ({ payout_item_id: `IT${i}`, payout_batch_id: "PB1", transaction_status: statuses[i % 3], payout_item_fee: { currency: "USD", value: "0.25" },
          payout_item: { sender_item_id: it.sender_item_id, receiver: "x", amount: { currency: "USD", value: "1.00" } } })),
        total_pages: 1,
      })]);
      const { client } = makeClient(pp.fetch);
      const r = await readBack(desk(), client, batchId);
      expect(r.status).toBe("SUCCESS");
      expect(Object.keys(r.outcomes).sort()).toEqual(["FAILED", "PAID", "UNCLAIMED"].filter((o, i) => i < items.length));
      const first = await getClaim(pool, items[0]?.sender_item_id ?? "");
      expect(first?.status).toBe("PAID");
    });
  });

  describe("analyst login", () => {
    const network = "net-test";
    it("hashes with a fresh salt, and verifies only the right password", async () => {
      const a = await hashPassword("a long enough password");
      const b = await hashPassword("a long enough password");
      expect(a).toMatch(/^scrypt\$131072\$8\$1\$/);
      expect(a).not.toBe(b);
      expect(await verifyPassword("a long enough password", a)).toBe(true);
      expect(await verifyPassword("a long enough passworD", a)).toBe(false);
      expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
      await expect(hashPassword("short")).rejects.toThrow("at least 12");
    }, 30_000);

    it("logs in, opens a session only with its token, and logs out", async () => {
      const r = await login(pool, { email: " SOL@example.com ", password: "correct horse battery", network });
      if (!r.ok) throw new Error(r.error);
      expect(r.analyst).toMatchObject({ email: "sol@example.com", role: "supervisor" });
      expect(await analystFromToken(pool, r.token)).toEqual(r.analyst);
      expect(await analystFromToken(pool, `${r.token}x`)).toBeNull();
      expect(await analystFromToken(pool, undefined)).toBeNull();
      const { rows } = await pool.query("SELECT encode(token_hash, 'hex') AS h FROM analyst_sessions");
      expect(rows.map((x) => x.h)).not.toContain(Buffer.from(r.token).toString("hex")); // only the hash is stored
      await logout(pool, r.token);
      expect(await analystFromToken(pool, r.token)).toBeNull();
    }, 30_000);

    it("refuses a wrong password or unknown email the same way, records it, and locks out after 5", async () => {
      const bad = await login(pool, { email: "nobody@example.com", password: "whatever whatever", network });
      expect(bad).toEqual({ ok: false, error: "That email and password don't match an analyst account." });
      for (let i = 0; i < 5; i++) {
        const r = await login(pool, { email: "lee@example.com", password: `wrong password ${i}`, network: `n${i}` });
        expect(r).toEqual({ ok: false, error: "That email and password don't match an analyst account." });
      }
      const locked = await login(pool, { email: "lee@example.com", password: "correct horse battery", network: "elsewhere" });
      expect(locked).toEqual({ ok: false, error: "Too many failed attempts. Try again in 15 minutes." });
      const { rows } = await pool.query("SELECT action, count(*)::int AS n FROM audit_log WHERE subject = 'lee@example.com' AND action LIKE 'login%' GROUP BY action ORDER BY action");
      expect(rows).toEqual([{ action: "login_failed", n: 5 }, { action: "login_locked", n: 1 }]);
    }, 60_000);
  });
});
