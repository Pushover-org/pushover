import { parseSettlement, type Findings } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { getClaim, latestDecision, latestFindings, recordWebhookEvent, type Pool } from "@proofofclaim/db";
import type { ExamineResult } from "@proofofclaim/examiner";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, freshDatabase } from "../../db/test/testdb.ts";
import { fakePayPal, json, makeClient } from "../../paypal/test/fake.ts";
import {
  analystFromToken, approveAndDistribute, cancelProposal, claimantReturns, claimByStatusToken, ClaimRejectedError, pseudonymOf, decideClaim, fileClaim, hashPassword, login, logout, MoneyRefusedError, openProposal, planDistribution,
  proposeDistribution, readBack, recheckApproved, reviewClaim, setAnalyst, submitClaim, verifyPassword, type Desk, type FileClaimInput,
  approveCyPres, checkBalance, confirmInHistory, expireReoffers, planCyPres, processWebhooks, proposeCyPres, requestReoffer,
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

const KEYS = { seal: Buffer.alloc(32, 1), pseudonym: Buffer.alloc(32, 2) };

/** PayPal's balance reply, in the shape the sandbox returned (as of two hours ago by default). */
const balance = (value = "6387.15", asOf = new Date(Date.now() - 2 * 3_600_000)) =>
  json(200, { balances: [{ currency: "USD", total_balance: { currency_code: "USD", value }, available_balance: { currency_code: "USD", value }, withheld_balance: { currency_code: "USD", value: "0.00" } }], as_of_time: asOf.toISOString() });

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
    pool, settlement: S, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: "desk-test", keys: KEYS,
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
    // A desk without the identity keys can't take a PayPal claim at all.
    await expect(fileClaim({ ...desk(), keys: null }, claim({ paypal: { ...paypal, payerId: "DEFGHJKLMNPQ5" } }))).rejects.toThrow("PAYER_SEAL_KEY");
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

    it("the re-check doesn't undo a person's approval, but a cluster that forms afterwards pulls it back", async () => {
      const template = "On many occasions I ordered bottled sodas with meals at family restaurants and I affirm this claim is true and correct.";
      reading = () => ({ status: "NOT_RUN", findings: null, model: "fake", stopReason: null, inputTokens: 0, outputTokens: 0, costUsd: 0, error: "not run" });
      const { claim: c, result } = await submitClaim(desk(), claim({ tier: "proof", image: await photo(41), declaration: `${template} First.` }));
      reading = null;
      expect(result?.decision).toMatchObject({ outcome: "REVIEW", reason: "EXAMINER_NOT_RUN" });
      await reviewClaim(desk(), c.id, "APPROVE", "rhea@example.com");
      expect((await recheckApproved(desk())).map((m) => m.claimId)).not.toContain(c.id);
      expect((await getClaim(pool, c.id))?.status).toBe("APPROVE");
      for (let i = 0; i < 4; i++) await fileClaim(desk(), claim({ declaration: `${template} Copy ${i}.` }));
      expect(await recheckApproved(desk())).toContainEqual({ claimId: c.id, outcome: "REVIEW", reason: "TEMPLATE_CLUSTER" });
      expect(await latestDecision(pool, c.id)).toMatchObject({ outcome: "REVIEW", reason: "TEMPLATE_CLUSTER", rule: 3, decidedBy: "system" });
    });

    let ana: Analyst;
    let lee: Analyst;
    let sol: Analyst;
    const sendsPB1 = () => fakePayPal([balance(), (call) => {
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

    it("if what would be paid changes between proposal and approval, nothing is sent and the proposal is superseded", async () => {
      const { proposal: open } = await proposeDistribution(desk(), ana); // no cap: every approved claim is in it
      await submitClaim(desk(), claim({ declaration: "A late claim: I had a lemonade with dinner at a cafe in Fresno in 2018." }));
      const never = fakePayPal([]);
      const { client } = makeClient(never.fetch);
      await expect(approveAndDistribute(desk(), client, sol, open.id)).rejects.toThrow(MoneyRefusedError);
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
      expect(plan.fundCents).toBe(S.fundCents);
      // The cap never shrinks a share: each claim paid now gets its full entitlement (the fund covers everyone).
      for (const p of plan.allocation.payouts) expect(p.payoutCents).toBe(p.entitlementCents);
      expect(plan.payees.find((p) => p.payerId)).toBeUndefined(); // the one PayPal-account claim above is still unread, not approved
      const { proposal } = await proposeDistribution(desk(), ana, { capCents: 5000 });
      const pp = sendsPB1();
      const { client } = makeClient(pp.fetch);
      const out = await approveAndDistribute(desk(), client, sol, proposal.id, { capCents: 5000 });
      expect(pp.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["GET /v1/reporting/balances", "POST /v1/payments/payouts"]);
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

    it("a cap pays claims in filing order, each in full, and leaves the rest approved for the next round", async () => {
      for (let i = 0; i < 3; i++) await submitClaim(desk(), claim({ declaration: `Capped claim ${i}: a ginger ale with supper at a grill in Sacramento, ${2015 + i}.` }));
      const cap = 2500;
      const plan = await planDistribution(desk(), { capCents: cap });
      const uncapped = await planDistribution(desk());
      const sum = (ps: { payoutCents: number }[]) => ps.reduce((t, p) => t + p.payoutCents, 0);
      expect(plan.round).toBe(2);
      expect(uncapped.deferred).toBe(0);
      expect(plan.deferred).toBeGreaterThanOrEqual(1);
      expect(plan.allocation.payouts.length + plan.deferred).toBe(uncapped.allocation.payouts.length);
      for (const p of plan.allocation.payouts) expect(p.payoutCents).toBe(p.entitlementCents); // whole shares, never scaled to the cap
      // In filing order: today's claims are the first ones, and the next one wouldn't have fitted.
      expect(plan.allocation.payouts).toEqual(uncapped.allocation.payouts.slice(0, plan.allocation.payouts.length));
      expect(sum(plan.allocation.payouts)).toBeLessThanOrEqual(cap);
      expect(sum(uncapped.allocation.payouts.slice(0, plan.allocation.payouts.length + 1))).toBeGreaterThan(cap);
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
      const outcomeOf: Record<string, string> = { SUCCESS: "PAID", UNCLAIMED: "UNCLAIMED", FAILED: "FAILED" };
      expect(Object.keys(r.outcomes).sort()).toEqual([...new Set(items.map((_, i) => outcomeOf[statuses[i % 3] ?? ""]))].sort());
      const first = await getClaim(pool, items[0]?.sender_item_id ?? "");
      expect(first?.status).toBe("PAID");
    });
  });

  describe("claimant privacy (P2, P4–P6)", () => {
    const row = async (id: string) => (await pool.query("SELECT row_to_json(c)::text AS j FROM claims c WHERE id = $1", [id])).rows[0]?.j as string;

    it("pays a PayPal claimant at their account, while the claim, the plan and the proposal hold only the pseudonym", async () => {
      const payerId = "ABCDEFGHJKLM2";
      const { claim: c, result } = await submitClaim(desk(), claim({ paypal: { payerId, verified: true, emailVerified: true }, declaration: "A root beer float at a drive-in on Route 66 near Barstow, July 2016, with my cousins." }));
      expect(result?.decision.outcome).toBe("APPROVE");
      expect(await row(c.id)).not.toContain(payerId);
      const plan = await planDistribution(desk());
      expect(plan.payees).toContainEqual({ claimId: c.id, payerId });
      expect(plan.receivers[c.id]).toBe(`pseudonym:${pseudonymOf(KEYS, S.id, payerId)}`);
      const pia = await setAnalyst(pool, { email: "pia@example.com", name: "Pia", role: "analyst", password: "correct horse battery" }, "test");
      const { proposal } = await proposeDistribution(desk(), pia);
      expect(JSON.stringify(proposal.plan)).not.toContain(payerId);
      expect(JSON.stringify(proposal.plan)).toContain(pseudonymOf(KEYS, S.id, payerId));
      await cancelProposal(desk(), pia, proposal.id);
    }, 30_000);

    it("an approved claim from an unverified PayPal account waits, and is paid once its owner logs in verified", async () => {
      const payerId = "BCDEFGHJKLMN3";
      const { claim: c, statusToken } = await submitClaim(desk(), claim({ paypal: { payerId, verified: false, emailVerified: null }, declaration: "Hot cocoa twice at a ski lodge cafe in Mammoth Lakes over New Year 2018." }));
      expect((await getClaim(pool, c.id))?.status).toBe("APPROVE");
      const before = await planDistribution(desk());
      expect(before.waitingVerification).toBe(1);
      expect(before.payees.map((p) => p.claimId)).not.toContain(c.id);
      const back = await claimantReturns(desk(), { payerId, verified: true, emailVerified: true });
      expect(back?.claimId).toBe(c.id);
      const after = await planDistribution(desk());
      expect(after.waitingVerification).toBe(0);
      expect(after.payees).toContainEqual({ claimId: c.id, payerId });
      // Logging in again issues a new private link and retires the old one.
      expect(await claimByStatusToken(desk(), statusToken)).toBeNull();
      expect(await claimByStatusToken(desk(), back?.statusToken ?? "")).toBe(c.id);
      expect(await claimantReturns(desk(), { payerId: "CDEFGHJKLMNP4", verified: true, emailVerified: true })).toBeNull();
    });

    it("a status link finds only its own claim", async () => {
      const { claim: c, statusToken } = await submitClaim(desk(), claim({ declaration: "Iced coffee at a bakery counter in Buffalo, a Saturday in October 2017." }));
      expect(statusToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(await claimByStatusToken(desk(), statusToken)).toBe(c.id);
      expect(await claimByStatusToken(desk(), "A".repeat(32))).toBeNull();
      expect(await claimByStatusToken(desk(), "../../etc/passwd")).toBeNull();
      expect(await row(c.id)).not.toContain(statusToken);
    });
  });

  describe("after Distribute: balance, digest, history, webhooks, re-offer, cy-près (R11)", () => {
    let ana: Analyst;
    let sol: Analyst;
    let sentBody: { sender_batch_header: { email_message: string }; items: { note?: string; sender_item_id: string }[] } | null = null;
    let round2: { batchId: number; paypalBatchId: string; items: string[] } = { batchId: 0, paypalBatchId: "", items: [] };
    const fresh = (decl: string) => submitClaim(desk(), claim({ declaration: decl }));

    it("refuses a round PayPal can't cover, counting what we sent after the balance's time", async () => {
      ana = await setAnalyst(pool, { email: "ana2@example.com", name: "Ana", role: "analyst", password: "correct horse battery" }, "test");
      sol = await setAnalyst(pool, { email: "sol2@example.com", name: "Sol", role: "supervisor", password: "correct horse battery" }, "test");
      await fresh("A malted milkshake at a soda fountain in Burbank in August 2015, with fries.");
      const { proposal } = await proposeDistribution(desk(), ana);
      // The balance predates every batch in this database, so all of them count against it.
      const pp = fakePayPal([balance("1.00", new Date(Date.now() - 365 * 86_400_000))]);
      const { client } = makeClient(pp.fetch);
      await expect(approveAndDistribute(desk(), client, sol, proposal.id)).rejects.toThrow(/available as of .* less \$\d+\.\d\d we've sent since/);
      expect(pp.calls.map((c) => c.method)).toEqual(["GET"]); // asked for the balance, sent nothing
      expect((await openProposal(pool, S.id, "CLAIMS"))?.id).toBe(proposal.id); // still open for when the money is there
    });

    it("puts the approved plan's digest on every payout and in the email", async () => {
      const open = await openProposal(pool, S.id, "CLAIMS");
      const pp = fakePayPal([balance(), (call) => {
        sentBody = JSON.parse(call.body ?? "{}");
        return json(201, { batch_header: { payout_batch_id: "PB2", batch_status: "PENDING", sender_batch_header: (sentBody as unknown as { sender_batch_header: object }).sender_batch_header } });
      }]);
      const { client } = makeClient(pp.fetch);
      const out = await approveAndDistribute(desk(), client, sol, open?.id ?? -1);
      const hex = open?.planHash.toString("hex") ?? "";
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
      expect(sentBody?.items.length).toBeGreaterThan(0);
      for (const it of sentBody?.items ?? []) expect(it.note).toBe(`Proof of Claim ${S.id} claims round ${out.round}, plan sha256:${hex}`);
      expect(sentBody?.sender_batch_header.email_message).toContain(`plan sha256:${hex.slice(0, 16)}`);
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM payout_batches WHERE paypal_batch_id = 'PB2'");
      round2 = { batchId: Number(rows[0]?.id), paypalBatchId: "PB2", items: (sentBody?.items ?? []).map((i) => i.sender_item_id) };
    });

    it("read-back keeps each item's PayPal transaction, and money that came back starts the re-offer clock", async () => {
      const [back, ...rest] = round2.items;
      const pp = fakePayPal([json(200, {
        batch_header: { payout_batch_id: "PB2", batch_status: "SUCCESS", sender_batch_header: {} }, total_pages: 1,
        items: round2.items.map((id, i) => ({ payout_item_id: `IT2-${i}`, transaction_id: `TX2${String(i).padStart(14, "0")}`, payout_batch_id: "PB2",
          transaction_status: id === back ? "RETURNED" : "SUCCESS", payout_item_fee: { currency: "USD", value: "0.25" },
          payout_item: { sender_item_id: id, receiver: "x", amount: { currency: "USD", value: "1.00" } } })),
      })]);
      const { client } = makeClient(pp.fetch);
      await readBack(desk(), client, round2.batchId);
      const { rows } = await pool.query("SELECT sender_item_id, paypal_transaction_id FROM payout_items WHERE batch_id = $1 ORDER BY id", [round2.batchId]);
      expect(rows.every((r) => /^TX2\d{14}$/.test(r.paypal_transaction_id))).toBe(true);
      expect((await getClaim(pool, back ?? ""))?.status).toBe("RETURNED");
      const { rows: c } = await pool.query("SELECT money_back_at FROM claims WHERE id = $1", [back]);
      expect(c[0].money_back_at).toBeInstanceOf(Date);
      expect(rest.length).toBeGreaterThanOrEqual(0);
    });

    it("checks each payout against PayPal's own history: waiting, confirmed, or flagged after 3 days", async () => {
      // A Response body can be read once, so each reply is made fresh.
      const notYet = () => json(404, { name: "INVALID_REQUEST", message: "Data for the given start date is not available." });
      const found = (id: string) => json(200, { transaction_details: [{ transaction_info: { transaction_id: id, transaction_event_code: "T0001", transaction_status: "S", transaction_amount: { value: "-1.00" }, fee_amount: { value: "-0.25" } } }] });
      const n = round2.items.length;
      const first = fakePayPal(Array.from({ length: n }, () => notYet()));
      expect(await confirmInHistory(desk(), makeClient(first.fetch).client, { limit: n })).toEqual({ WAITING: n });
      const second = fakePayPal(Array.from({ length: n }, (_, i) => (i === 0 ? json(200, { transaction_details: [] }) : found(`TX2${String(i).padStart(14, "0")}`))));
      const later = new Date(Date.now() + 4 * 86_400_000);
      const r = await confirmInHistory(desk(), makeClient(second.fetch).client, { limit: n, now: later });
      expect(r).toEqual(n > 1 ? { NEVER_CAUGHT_UP: 1, CONFIRMED: n - 1 } : { NEVER_CAUGHT_UP: 1 });
      const { rows } = await pool.query("SELECT DISTINCT history_code FROM payout_items WHERE history_status = 'CONFIRMED'");
      if (n > 1) expect(rows).toEqual([{ history_code: "T0001 S" }]);
    });

    it("a claimant whose payment came back can ask for it again, once in the window", async () => {
      const id = round2.items[0] ?? "";
      const never = await fresh("Lemon soda with a burrito at a taqueria in Oakland, spring 2019.");
      await expect(requestReoffer(desk(), never.claim.id)).rejects.toThrow("Only a payment that came back");
      await requestReoffer(desk(), id);
      expect((await getClaim(pool, id))?.status).toBe("APPROVE");
      const { rows } = await pool.query("SELECT reoffers, money_back_at FROM claims WHERE id = $1", [id]);
      expect(rows[0]).toEqual({ reoffers: 1, money_back_at: null });
    });

    it("money not asked for again within the window becomes cy-près eligible, and can't be re-offered", async () => {
      const id = round2.items[0] ?? "";
      // Pretend it was sent again and came back long ago.
      await pool.query("UPDATE claims SET status = 'RETURNED', money_back_at = now() - interval '40 days' WHERE id = $1", [id]);
      expect(await expireReoffers(desk())).toBe(1);
      expect((await getClaim(pool, id))?.status).toBe("CY_PRES_ELIGIBLE");
      await expect(requestReoffer(desk(), id)).rejects.toThrow("Only a payment that came back");
    });

    it("cy-près: two people send the returned money to the court's nonprofit, once", async () => {
      const id = round2.items[0] ?? "";
      // What came back is what we sent, from our own record of the payout.
      const { rows: sent } = await pool.query<{ cents: string }>("SELECT amount_cents AS cents FROM payout_items WHERE batch_id = $1 AND claim_id = $2", [round2.batchId, id]);
      const cents = Number(sent[0]?.cents);
      const plan = await planCyPres(desk());
      expect(plan.items).toEqual([{ claimId: id, cents }]);
      expect(plan.recipient).toEqual({ name: S.cyPres.name, email: S.cyPres.payoutEmail });
      const p = await proposeCyPres(desk(), ana);
      const never = fakePayPal([]);
      await expect(approveCyPres(desk(), makeClient(never.fetch).client, ana, p.id)).rejects.toThrow("you proposed this one");
      // A holder, not a bare let: TypeScript can't see the assignment inside the callback.
      const seen: { body: { items: { receiver: string; amount: { value: string }; note: string }[]; sender_batch_header: object } | null } = { body: null };
      const pp = fakePayPal([balance(), (call) => {
        seen.body = JSON.parse(call.body ?? "{}");
        return json(201, { batch_header: { payout_batch_id: "CP1", batch_status: "PENDING", sender_batch_header: seen.body?.sender_batch_header } });
      }]);
      const body = () => seen.body;
      const out = await approveCyPres(desk(), makeClient(pp.fetch).client, sol, p.id);
      expect(out).toMatchObject({ paypalBatchId: "CP1", cents });
      expect(body()?.items).toEqual([expect.objectContaining({ receiver: S.cyPres.payoutEmail, amount: { currency: "USD", value: (cents / 100).toFixed(2) }, note: expect.stringContaining("cy_pres round 1, plan sha256:") })]);
      const { rows } = await pool.query("SELECT claim_id, cents FROM cy_pres_claims");
      expect(rows).toEqual([{ claim_id: id, cents: String(cents) }]);
      const { rows: t } = await pool.query("SELECT approved_by, cents FROM cy_pres_transfers");
      expect(t).toEqual([{ approved_by: "analyst:sol2@example.com", cents: String(cents) }]);
      await expect(proposeCyPres(desk(), ana)).rejects.toThrow("No returned money is waiting");
    });

    it("the balance check subtracts exactly what we sent after the balance's time, with fees", async () => {
      const { rows } = await pool.query<{ cents: number; items: number }>(
        "SELECT COALESCE(sum(amount_cents), 0)::int AS cents, (SELECT count(*)::int FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id WHERE b.paypal_batch_id IS NOT NULL) AS items FROM payout_batches WHERE paypal_batch_id IS NOT NULL",
      );
      const sent = (rows[0]?.cents ?? 0) + (rows[0]?.items ?? 0) * 25;
      expect(sent).toBeGreaterThan(0);
      const longAgo = new Date(Date.now() - 365 * 86_400_000);
      // $1.00 plus a $0.25 fee fits only if nothing we sent is subtracted.
      const short = makeClient(fakePayPal([balance(((sent + 124) / 100).toFixed(2), longAgo)]).fetch).client;
      await expect(checkBalance(desk(), short, 100, 1)).rejects.toThrow(`less $${(sent / 100).toFixed(2)} we've sent since`);
      const enough = makeClient(fakePayPal([balance(((sent + 125) / 100).toFixed(2), longAgo)]).fetch).client;
      await expect(checkBalance(desk(), enough, 100, 1)).resolves.toMatchObject({ sentSinceCents: sent });
      // A balance newer than every batch subtracts nothing.
      const fresh = makeClient(fakePayPal([balance("1.25", new Date(Date.now() + 60_000))]).fetch).client;
      await expect(checkBalance(desk(), fresh, 100, 1)).resolves.toMatchObject({ sentSinceCents: 0 });
    });

    it("a verified webhook only triggers a read-back of our batch; a replay and an unknown batch do nothing", async () => {
      const event = { id: "WH-EVT-1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_batch_id: "PB2", payout_item_id: "IT2-1" } };
      expect(await recordWebhookEvent(pool, { id: event.id, type: event.event_type, payload: event })).toBe(true);
      expect(await recordWebhookEvent(pool, { id: event.id, type: event.event_type, payload: event })).toBe(false);
      await recordWebhookEvent(pool, { id: "WH-EVT-2", type: "PAYMENT.PAYOUTSBATCH.SUCCESS", payload: { id: "WH-EVT-2", resource: { batch_header: { payout_batch_id: "NOT-OURS" } } } });
      const pp = fakePayPal([json(200, { batch_header: { payout_batch_id: "PB2", batch_status: "SUCCESS", sender_batch_header: {} }, total_pages: 1, items: [] })]);
      const r = await processWebhooks(pool, makeClient(pp.fetch).client, async (sid) => (sid === S.id ? desk() : null));
      expect(r).toEqual({ readBacks: 1, ignored: 1 });
      expect(pp.calls.map((c) => c.url)).toEqual([expect.stringContaining("/v1/payments/payouts/PB2")]);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM webhook_events WHERE processed_at IS NULL");
      expect(rows[0].n).toBe(0);
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
