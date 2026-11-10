// Claims an assistant files for a person (P11, P13, P14, C14), on real Postgres.
// The rule under test: an assistant can file; only the person, confirmed through PayPal, makes it a
// claim, and only then can it be read, checked, decided or paid.
import { parseSettlement, type Findings } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { getClaim, latestDecision, latestFindings, type Pool } from "@proofofclaim/db";
import type { ExamineResult } from "@proofofclaim/examiner";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, freshDatabase } from "../../db/test/testdb.ts";
import {
  claimByStatusToken, ClaimRejectedError, confirmFiling, disownFiling, fileForPerson, filingToConfirm, lapseUnconfirmed, planCyPres, planDistribution, pseudonymOf, submitClaim,
  UNBOUND_DAYS, type AssistantFiling, type Desk, type FileClaimInput,
} from "../src/index.ts";

const S = parseSettlement({
  id: "assist-test", name: "Assistant Test Settlement (fictional demo)", demo: true, currency: "USD", fundCents: 200_000, adminReserveCents: 10_000,
  classPeriod: { start: "2015-01-01", end: "2019-12-31" }, products: [{ id: "restaurant-drink", name: "Non-alcoholic drink", description: "Any non-alcoholic drink bought at a restaurant" }],
  geography: { states: ["CA", "NY"] }, tiers: { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } }, cyPres: { name: "Clean Water Access Fund (demo)", payoutEmail: "po-merchant-baseline-3h8w@business.example.com" },
});

const findings = (): Findings => ({
  document_type: "receipt", merchant_name: "Green Field", merchant_address: "5305 E Pacific Coast Hwy, Long Beach, CA 90804", merchant_state: "CA", purchase_date: "2016-05-26",
  line_items: [{ description: "Coffee", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }, { description: "Lunch", qty: 2, unit_cents: null, line_total_cents: 4590, matches_product_id: null }, { description: "Coke", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }],
  adjustments: [], subtotal_cents: 5190, tax_cents: 468, total_cents: 5658, visual_anomalies: [], declaration_consistent_with_evidence: "yes", declaration_issues: [], confidence: "high", model_recommendation: "approve",
});

async function photo(seed: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(64 * 64);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i * 0.53 + seed * 7.1) * 127 + 128) & 255;
  return sharp(raw, { raw: { width: 64, height: 64, channels: 1 } }).jpeg().toBuffer();
}

const KEYS = { seal: Buffer.alloc(32, 3), pseudonym: Buffer.alloc(32, 4) };
// Valid-looking PayPal payer IDs (13 characters from PayPal's alphabet), one per person.
const payer = (k: number) => `PAYER${[...k.toString(8).padStart(8, "0")].map((d) => String(Number(d) + 2)).join("")}`;

let n = 0;
const DRINKS = ["iced tea", "lemonade", "root beer", "hot cocoa", "an espresso", "cream soda", "ginger ale", "a milkshake", "sweet tea", "horchata"];
const TOWNS = ["Fresno", "Albany", "Buffalo", "Modesto", "Yonkers", "Syracuse", "Oakland", "Ithaca", "Redding", "Utica"];
const ownWords = (k: number) => `I had ${DRINKS[k % DRINKS.length]} at a diner in ${TOWNS[(k * 3) % TOWNS.length]} in ${2015 + (k % 5)}, case ${k * 7919}.`;

const filing = (over: Partial<AssistantFiling> = {}): AssistantFiling => {
  n++;
  return {
    agentName: "Helper Bot", tier: "no_proof", unitsClaimed: 1, name: `Person ${n}`, email: `typed-${n}@assistant.example`, addressLine: `${n} Oak Ave`, city: "Fresno", state: "CA", zip: "93701",
    declaration: ownWords(n), image: null, ...over,
  };
};
const formClaim = (over: Partial<FileClaimInput> = {}): FileClaimInput => {
  n++;
  return {
    tier: "no_proof", unitsClaimed: 1, name: `Person ${n}`, email: `p${n}@example.com`, addressLine: `${n} Main St`, city: "Long Beach", state: "CA", zip: "90804",
    declaration: ownWords(n), ip: `2001:db8:${n.toString(16)}::1`, image: null, paypal: null, ...over,
  };
};
const person = (k: number, over: { verified?: boolean } = {}) => ({
  paypal: { payerId: payer(k), email: `paypal-${k}@example.com`, verified: over.verified ?? true, emailVerified: true }, ip: `198.51.100.${k % 250}`, deviceId: `device-${k}-abcdefghijklmn`.slice(0, 22),
});

describe.skipIf(!DATABASE_URL)("claims an assistant files for a person", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let reads = 0;
  const desk = (): Desk => ({
    pool, settlement: S, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: "assist-test", keys: KEYS,
    read: async (): Promise<ExamineResult> => {
      reads++;
      // A different restaurant per receipt, so C12 (same merchant, date and total) only fires on a real repeat.
      return { status: "OK", findings: { ...findings(), merchant_name: `Green Field ${reads}` }, model: "fake", stopReason: "end_turn", inputTokens: 0, outputTokens: 0, costUsd: 0, error: null };
    },
  });

  beforeAll(async () => {
    ({ pool, drop } = await freshDatabase());
    await pool.query("INSERT INTO settlements (id, name, config, fund_cents) VALUES ($1, $2, $3, $4)", [S.id, S.name, JSON.stringify(S), S.fundCents]);
  });
  afterAll(async () => drop?.());

  it("an assistant's filing waits UNBOUND: its receipt is stored but not read, and nothing is decided", async () => {
    const before = reads;
    const { claim, confirmToken, statusToken, lapsesAt } = await fileForPerson(desk(), filing({ tier: "proof", unitsClaimed: 2, image: await photo(1) }));
    expect(claim).toMatchObject({ status: "UNBOUND", filedVia: "ASSISTANT", agentName: "Helper Bot", paypal: null, boundAt: null });
    expect(reads).toBe(before);
    expect(await latestFindings(pool, claim.id)).toBeNull();
    expect(await latestDecision(pool, claim.id)).toBeNull();
    expect(confirmToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await claimByStatusToken(desk(), statusToken)).toBe(claim.id);
    expect(lapsesAt.getTime() - (claim.agentFiledAt as Date).getTime()).toBe(UNBOUND_DAYS * 86_400_000);
    const seen = await filingToConfirm(desk(), confirmToken);
    expect(seen).toMatchObject({ claimId: claim.id, agentName: "Helper Bot", hasReceipt: true, tier: "proof", unitsClaimed: 2 });
    // The tokens themselves are never stored.
    const row = (await pool.query("SELECT row_to_json(c)::text AS j FROM claims c WHERE id = $1", [claim.id])).rows[0]?.j as string;
    expect(row).not.toContain(confirmToken);
    expect(row).not.toContain(statusToken);
  });

  describe("an unconfirmed filing is never paid", () => {
    it("is in no Distribute plan and no cy-près plan, even with an approval forced into its record", async () => {
      const { claim } = await fileForPerson(desk(), filing());
      const before = { pay: await planDistribution(desk()), cyPres: await planCyPres(desk()) };
      // Pretend something wrote an approval for it: the plans still go by the claim's own state.
      await pool.query(
        `INSERT INTO decisions (claim_id, outcome, reason, rule, decision_version, units, entitlement_cents, decided_by)
         VALUES ($1, 'APPROVE', 'APPROVED_NO_PROOF', 7, 'decision-v1', 1, 1000, 'system')`,
        [claim.id],
      );
      const plan = await planDistribution(desk());
      expect(plan.payees.map((p) => p.claimId)).not.toContain(claim.id);
      expect(plan.allocation.payouts.map((p) => p.claimId)).not.toContain(claim.id);
      expect(Object.keys(plan.receivers)).not.toContain(claim.id);
      expect((await planCyPres(desk())).items.map((i) => i.claimId)).not.toContain(claim.id);
      // Not even as a share of the fund: every other claimant's share and the leftover are unchanged.
      expect(plan).toEqual(before.pay);
      expect(await planCyPres(desk())).toEqual(before.cyPres);
    });

    it("the database refuses to approve it, schedule it or plan a payout for it", async () => {
      const { claim } = await fileForPerson(desk(), filing());
      for (const to of ["APPROVE", "SUBMITTED", "SCHEDULED", "PAID"]) {
        await expect(pool.query("UPDATE claims SET status = $2 WHERE id = $1", [claim.id, to])).rejects.toThrow(/claims_assistant_claim_is_bound_to_paypal/);
      }
      // A BEFORE trigger runs before foreign keys are checked, so no batch row is needed to see it refuse.
      await expect(
        pool.query("INSERT INTO payout_items (batch_id, claim_id, sender_item_id, receiver, amount_cents) VALUES (0, $1, $1, 'typed@assistant.example', 1000)", [claim.id]),
      ).rejects.toThrow(/never confirmed by its person/);
    });

    it("once confirmed and approved, it is paid only to the PayPal account that confirmed it, never to the email the assistant typed", async () => {
      const f = filing();
      const { confirmToken } = await fileForPerson(desk(), f);
      const { claim, result } = await confirmFiling(desk(), confirmToken, person(1));
      expect(result?.decision.outcome).toBe("APPROVE");
      expect(claim.email).toBe("paypal-1@example.com");
      const plan = await planDistribution(desk());
      expect(plan.payees).toContainEqual({ claimId: claim.id, payerId: payer(1) });
      expect(plan.receivers[claim.id]).toBe(`pseudonym:${pseudonymOf(KEYS, S.id, payer(1))}`);
      expect(JSON.stringify(plan)).not.toContain(f.email);
      await expect(
        pool.query("INSERT INTO payout_items (batch_id, claim_id, sender_item_id, receiver, amount_cents) VALUES (0, $1, $1, $2, 1000)", [claim.id, f.email]),
      ).rejects.toThrow(/paid only to the PayPal account that confirmed it/);
    });
  });

  describe("confirming", () => {
    it("binds the filing to the person's PayPal account, then reads, checks and decides it like a form claim", async () => {
      const before = reads;
      const { claim: filed, confirmToken, statusToken: agentLink } = await fileForPerson(desk(), filing({ tier: "proof", unitsClaimed: 2, image: await photo(2) }));
      const { claim, result, statusToken } = await confirmFiling(desk(), confirmToken, person(2));
      expect(reads).toBe(before + 1);
      expect(claim).toMatchObject({ id: filed.id, status: "SUBMITTED", filedVia: "ASSISTANT", agentName: "Helper Bot" });
      expect(claim.boundAt).toBeInstanceOf(Date);
      expect(claim.seq).toBeGreaterThan(filed.seq);
      expect(result?.decision).toMatchObject({ outcome: "APPROVE", units: 2, entitlementCents: 3000 });
      expect((await getClaim(pool, claim.id))?.status).toBe("APPROVE");
      // The claim is the person's now: their new link works, the assistant's stops.
      expect(await claimByStatusToken(desk(), statusToken)).toBe(claim.id);
      expect(await claimByStatusToken(desk(), agentLink)).toBeNull();
    });

    it("a link confirms once: a second PayPal account can't take the claim", async () => {
      const { confirmToken } = await fileForPerson(desk(), filing());
      await confirmFiling(desk(), confirmToken, person(3));
      await expect(confirmFiling(desk(), confirmToken, person(4))).rejects.toThrow(ClaimRejectedError);
      expect(await filingToConfirm(desk(), confirmToken)).toBeNull();
    });

    it("one PayPal account, one claim: confirming with an account that already filed is refused, and the filing stays unbound", async () => {
      await submitClaim(desk(), formClaim({ paypal: { payerId: payer(5), verified: true, emailVerified: true } }));
      const { claim, confirmToken } = await fileForPerson(desk(), filing());
      await expect(confirmFiling(desk(), confirmToken, person(5))).rejects.toThrow(/already filed a claim/);
      expect((await getClaim(pool, claim.id))?.status).toBe("UNBOUND");
    });

    it("an unverified PayPal account's claim is decided, then waits for verification like any other", async () => {
      const { confirmToken } = await fileForPerson(desk(), filing());
      const { claim, result } = await confirmFiling(desk(), confirmToken, person(6, { verified: false }));
      expect(result?.decision.outcome).toBe("APPROVE");
      const plan = await planDistribution(desk());
      expect(plan.payees.map((p) => p.claimId)).not.toContain(claim.id);
    });

    it("a made-up or malformed link finds nothing", async () => {
      expect(await filingToConfirm(desk(), "A".repeat(32))).toBeNull();
      expect(await filingToConfirm(desk(), "not a token")).toBeNull();
      await expect(confirmFiling(desk(), "B".repeat(32), person(7))).rejects.toThrow(/expired or was already used/);
    });
  });

  describe("filings nobody confirms", () => {
    it("'this isn't mine' closes the filing for good", async () => {
      const { claim, confirmToken } = await fileForPerson(desk(), filing());
      expect(await disownFiling(desk(), confirmToken)).toBe(true);
      expect((await getClaim(pool, claim.id))?.status).toBe("LAPSED");
      await expect(confirmFiling(desk(), confirmToken, person(8))).rejects.toThrow(ClaimRejectedError);
      expect(await disownFiling(desk(), confirmToken)).toBe(false);
    });

    it(`lapses after ${UNBOUND_DAYS} days, and can't be confirmed late`, async () => {
      const { claim, confirmToken } = await fileForPerson(desk(), filing());
      const later = new Date(Date.now() + (UNBOUND_DAYS + 1) * 86_400_000);
      await expect(confirmFiling(desk(), confirmToken, person(9), later)).rejects.toThrow(/expired/);
      expect(await lapseUnconfirmed(desk(), later)).toBeGreaterThanOrEqual(1);
      expect((await getClaim(pool, claim.id))?.status).toBe("LAPSED");
      expect(await lapseUnconfirmed(desk())).toBe(0);
    });
  });

  describe("unconfirmed filings can't be used against honest claimants", () => {
    it("a bot filing a stranger's receipt first doesn't make the stranger's own claim a duplicate (C6)", async () => {
      const receipt = await photo(77);
      await fileForPerson(desk(), filing({ tier: "proof", image: receipt }));
      const { result } = await submitClaim(desk(), formClaim({ tier: "proof", unitsClaimed: 1, image: receipt, paypal: { payerId: payer(10), verified: true, emailVerified: true } }));
      expect(result?.decision.outcome).toBe("APPROVE");
    });

    it("a thousand look-alike filings don't put an honest claim in a template or velocity cluster (C7, C9)", async () => {
      const template = "I bought soft drinks at restaurants in the class period and I swear this is true, please pay me.";
      for (let i = 0; i < 6; i++) await fileForPerson(desk(), filing({ declaration: `${template} ${i}` }));
      const { result } = await submitClaim(desk(), formClaim({ declaration: `${template} honest` }));
      expect(result?.decision.checks["C7"]).toBe("PASS");
      expect(result?.decision.outcome).toBe("APPROVE");
    });

    it("claims filed while a filing waited are compared with it once it's confirmed (it joins the filing order at the end)", async () => {
      const receipt = await photo(91);
      const { confirmToken } = await fileForPerson(desk(), filing({ tier: "proof", image: receipt }));
      const first = await submitClaim(desk(), formClaim({ tier: "proof", unitsClaimed: 1, image: receipt, paypal: { payerId: payer(11), verified: true, emailVerified: true } }));
      expect(first.result?.decision.outcome).toBe("APPROVE");
      const { result } = await confirmFiling(desk(), confirmToken, person(12));
      expect(result?.decision).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IMAGE" });
    });
  });
});
