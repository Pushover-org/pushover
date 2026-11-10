import { CHECKS_FOR_TIER, decide, parseSettlement, type Findings } from "@proofofclaim/claims";
import { hashRotations, loadTaxTable, PROVISIONAL_CONFIG, runChecks } from "@proofofclaim/checks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allArrivals, allDeclarations, analystForLogin, appendAudit, canMoveClaim, decideProposal, deleteSession, getProposal, insertAnalyst, insertProposal, insertSession, openProposal,
  recentFailedLogins, sessionAnalyst, type Analyst, checkResultsOf, earlierIdentities, earlierImageHashes, earlierReceiptDetails, getClaim, getEvidence, getSettlementConfig,
  insertClaim, insertEvidence, insertFindings, insertSettlement, latestDecision, latestFindings, listClaims, markBatchSent, moveClaim, payoutItemsOf, planBatch, recordAnalystDecision,
  recordCyPres, recordDecision, recordItemRead, withSettlementLock, type ClaimRow, type NewClaim, type Pool,
} from "../src/index.ts";
import { withTransaction } from "../src/pool.ts";
import { DATABASE_URL, freshDatabase } from "./testdb.ts";

const S = parseSettlement({
  id: "acme-restaurant-beverage", name: "Acme Restaurant Beverage Settlement (fictional demo)", demo: true, currency: "USD", fundCents: 300_000_000_000, adminReserveCents: 10_000,
  classPeriod: { start: "2015-01-01", end: "2019-12-31" }, products: [{ id: "restaurant-drink", name: "Non-alcoholic drink", description: "Any non-alcoholic drink bought at a restaurant" }],
  geography: { states: ["CA", "NY"] }, tiers: { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } }, cyPres: { name: "Clean Water Access Fund (demo)", payoutEmail: "po-merchant-baseline-3h8w@business.example.com" },
});

let n = 0;
const claim = (over: Partial<NewClaim> = {}): NewClaim => {
  n++;
  return { id: `c${n}`, settlementId: S.id, tier: "no_proof", unitsClaimed: 1, name: `Person ${n}`, email: `p${n}@example.com`, addressLine: `${n} Main St`, city: "Long Beach", state: "CA", zip: "90804", declaration: `I bought drink number ${n} somewhere nice.`, ipKey: `net${n}`, ...over };
};
const findings: Findings = {
  document_type: "receipt", merchant_name: "Green Field", merchant_address: "5305 E Pacific Coast Hwy, Long Beach, CA 90804", merchant_state: "CA", purchase_date: "2016-05-26",
  line_items: [{ description: "Coffee", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }, { description: "Lunch", qty: 2, unit_cents: null, line_total_cents: 4590, matches_product_id: null }, { description: "Coke", qty: 1, unit_cents: null, line_total_cents: 300, matches_product_id: "restaurant-drink" }],
  adjustments: [], subtotal_cents: 5190, tax_cents: 468, total_cents: 5658, visual_anomalies: [], declaration_consistent_with_evidence: "yes", declaration_issues: [], confidence: "high", model_recommendation: "approve",
};

describe.skipIf(!DATABASE_URL)("claims schema on real Postgres", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  const add = (over: Partial<NewClaim> = {}) => insertClaim(pool, claim(over));
  /** Decides a no-proof claim the way the app will: check and decide under the settlement lock. */
  const decideNoProof = (c: ClaimRow) =>
    withSettlementLock(pool, S.id, async (tx) => {
      const { checks } = runChecks(
        { claimId: c.id, tier: "no_proof", unitsClaimed: c.unitsClaimed, claimantState: c.state, identity: c, declaration: c.declaration },
        { settlement: S, table: loadTaxTable(), config: PROVISIONAL_CONFIG, findings: null, imageRotations: null, earlierImages: [], earlierReceipts: [],
          earlierIdentities: await earlierIdentities(tx, S.id, c.seq), declarations: await allDeclarations(tx, S.id), arrivals: await allArrivals(tx, S.id) },
      );
      const d = decide(S, { tier: "no_proof", unitsClaimed: c.unitsClaimed, examiner: { status: "NOT_RUN" }, checks });
      await recordDecision(tx, { claimId: c.id, from: c.status, decision: d, checks, decidedBy: "system" });
      return d;
    });

  let proposer: Analyst;
  let supervisor: Analyst;
  /** An approved money proposal, as the two-person flow leaves it (migration 0006). */
  const approvedProposal = (kind: "CLAIMS" | "CY_PRES" = "CLAIMS") =>
    withTransaction(pool, async (tx) => {
      const id = await insertProposal(tx, { settlementId: S.id, kind, planHash: Buffer.alloc(32, 7), plan: { test: true }, totalCents: 1500, by: proposer, ttlMinutes: 60 });
      expect(await decideProposal(tx, { id, status: "APPROVED", by: supervisor })).toBe(true);
      return id;
    });

  beforeAll(async () => {
    ({ pool, drop } = await freshDatabase());
    await insertSettlement(pool, S);
    proposer = await insertAnalyst(pool, { email: "ana@example.com", name: "Ana", role: "analyst", passwordHash: "scrypt$test" });
    supervisor = await insertAnalyst(pool, { email: "sol@example.com", name: "Sol", role: "supervisor", passwordHash: "scrypt$test" });
  });
  afterAll(async () => drop?.());

  it("the migration leaves Pushover's tables in place", async () => {
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const names = rows.map((r) => r.table_name);
    for (const t of ["customers", "orders", "captures", "refunds", "policy", "audit_log", "settlements", "claims", "decisions", "payout_items", "cy_pres_transfers"]) expect(names).toContain(t);
  });

  it("a settlement round-trips, and a fund above what integer holds stays exact", async () => {
    expect(parseSettlement(await getSettlementConfig(pool, S.id))).toEqual(S);
    const { rows } = await pool.query("SELECT fund_cents::text AS f FROM settlements WHERE id = $1", [S.id]);
    expect(rows[0].f).toBe("300000000000");
  });

  it("a claim round-trips, with its filing order", async () => {
    const a = await add();
    const b = await add();
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(await getClaim(pool, a.id)).toMatchObject({ id: a.id, status: "SUBMITTED", tier: "no_proof", state: "CA" });
    expect((await listClaims(pool, S.id, "SUBMITTED")).map((c) => c.id)).toContain(a.id);
  });

  it.each([
    ["an ID PayPal could not take", { id: "bad id!" }],
    ["zero units", { unitsClaimed: 0 }],
    ["an unknown settlement", { settlementId: "nope" }],
  ])("refuses a claim with %s", async (_n, over) => {
    await expect(add(over as Partial<NewClaim>)).rejects.toThrow();
  });

  it("evidence bytes and hash round-trip; only well-formed hashes fit", async () => {
    const c = await add();
    const bytes = new Uint8Array([1, 2, 3, 255]);
    await insertEvidence(pool, { claimId: c.id, contentType: "image/jpeg", bytes, sha256: "a".repeat(64), phash: "0".repeat(64) });
    const [e] = await getEvidence(pool, c.id);
    expect(e && [...e.bytes]).toEqual([...bytes]);
    await expect(insertEvidence(pool, { claimId: c.id, contentType: "image/jpeg", bytes, sha256: "a".repeat(64), phash: "not-a-hash" })).rejects.toThrow();
  });

  it("findings exist only for a good reading", async () => {
    const c = await add();
    await insertFindings(pool, { claimId: c.id, model: "claude-haiku-5-5", status: "OK", findings, costUsd: 0.001 });
    expect(await latestFindings(pool, c.id)).toMatchObject({ status: "OK", findings: { total_cents: 5658 } });
    await insertFindings(pool, { claimId: c.id, model: "claude-haiku-5-5", status: "REFUSED", findings: null, costUsd: 0 });
    expect(await latestFindings(pool, c.id)).toMatchObject({ status: "REFUSED", findings: null });
    await expect(insertFindings(pool, { claimId: c.id, model: "m", status: "REFUSED", findings, costUsd: 0 })).rejects.toThrow();
    await expect(insertFindings(pool, { claimId: c.id, model: "m", status: "OK", findings: null, costUsd: 0 })).rejects.toThrow();
  });

  it("the lookups see only earlier claims in this settlement", async () => {
    const a = await add();
    await insertEvidence(pool, { claimId: a.id, contentType: "image/png", bytes: new Uint8Array([1]), sha256: "b".repeat(64), phash: "1".repeat(64) });
    await insertFindings(pool, { claimId: a.id, model: "m", status: "OK", findings, costUsd: 0 });
    const b = await add();
    expect(await earlierImageHashes(pool, S.id, a.seq)).not.toContainEqual({ claimId: a.id, hash: "1".repeat(64) });
    expect(await earlierImageHashes(pool, S.id, b.seq)).toContainEqual({ claimId: a.id, hash: "1".repeat(64) });
    expect(await earlierReceiptDetails(pool, S.id, b.seq)).toContainEqual({ claimId: a.id, merchant: "Green Field", date: "2016-05-26", totalCents: 5658 });
    expect((await earlierIdentities(pool, S.id, b.seq)).find((e) => e.claimId === a.id)).toMatchObject({ status: "PENDING" });
  });

  describe("decisions", () => {
    it("records the decision, its checks and the audit entry together", async () => {
      const c = await add();
      const d = await decideNoProof(c);
      expect(d.outcome).toBe("APPROVE");
      const stored = await latestDecision(pool, c.id);
      expect(stored).toMatchObject({ outcome: "APPROVE", reason: "APPROVED_NO_PROOF", entitlementCents: 1000, decidedBy: "system" });
      expect((await checkResultsOf(pool, stored?.id as number)).map((r) => r.id).sort()).toEqual([...CHECKS_FOR_TIER.no_proof].sort());
      expect((await getClaim(pool, c.id))?.status).toBe("APPROVE");
      const { rows } = await pool.query("SELECT actor, action FROM audit_log WHERE subject = $1", [c.id]);
      expect(rows).toEqual([{ actor: "system", action: "decision" }]);
    });

    it("a decision cannot be edited or deleted, even by the table owner", async () => {
      const c = await add();
      await decideNoProof(c);
      await expect(pool.query("UPDATE decisions SET outcome = 'DENY' WHERE claim_id = $1", [c.id])).rejects.toThrow("append-only");
      await expect(pool.query("DELETE FROM decisions WHERE claim_id = $1", [c.id])).rejects.toThrow("append-only");
      await expect(pool.query("UPDATE check_results SET result = 'PASS'")).rejects.toThrow("append-only");
      await expect(pool.query("TRUNCATE decisions CASCADE")).rejects.toThrow("append-only");
    });

    it("if anything fails, nothing is stored", async () => {
      const c = await add();
      const d = decide(S, { tier: "no_proof", unitsClaimed: 1, examiner: { status: "NOT_RUN" }, checks: [] });
      await expect(withTransaction(pool, async (tx) => {
        await recordDecision(tx, { claimId: c.id, from: "PAID", decision: d, checks: [], decidedBy: "system" });
      })).rejects.toThrow("cannot go from");
      expect(await latestDecision(pool, c.id)).toBeNull();
      expect((await getClaim(pool, c.id))?.status).toBe("SUBMITTED");
    });

    it("an approval must carry an amount, and nothing else may", async () => {
      const c = await add();
      await expect(pool.query("INSERT INTO decisions (claim_id, decision_version, outcome, reason, decided_by) VALUES ($1, 'decision-v1', 'APPROVE', 'x', 'system')", [c.id])).rejects.toThrow();
      await expect(pool.query("INSERT INTO decisions (claim_id, decision_version, outcome, reason, entitlement_cents, decided_by) VALUES ($1, 'decision-v1', 'DENY', 'x', 500, 'system')", [c.id])).rejects.toThrow();
    });

    it("a person's decision is a new row; the earlier one stays", async () => {
      const c = await add();
      const held = CHECKS_FOR_TIER.no_proof.map((id) => ({ id, result: id === "C7" ? ("FAIL" as const) : ("PASS" as const), detail: "" }));
      await withTransaction(pool, (tx) => recordDecision(tx, { claimId: c.id, from: "SUBMITTED", decision: decide(S, { tier: "no_proof", unitsClaimed: 1, examiner: { status: "NOT_RUN" }, checks: held }), checks: held, decidedBy: "system" }));
      expect((await getClaim(pool, c.id))?.status).toBe("REVIEW");
      await withTransaction(pool, (tx) => recordAnalystDecision(tx, { claimId: c.id, outcome: "DENY", analyst: "sam", reason: "ANALYST_DENIED" }));
      expect(await latestDecision(pool, c.id)).toMatchObject({ outcome: "DENY", rule: null, decidedBy: "analyst:sam" });
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM decisions WHERE claim_id = $1", [c.id]);
      expect(rows[0].n).toBe(2);
    });

    it("two copies filed together: exactly one is approved, the other is denied (fix 6)", async () => {
      const shared = { email: "twin@example.com", addressLine: "77 Twin St", zip: "90210" };
      const a = await add({ ...shared, name: "Twin A", declaration: "I bought a tea at a diner on my lunch break." });
      const b = await add({ ...shared, name: "Twin B", declaration: "Coffee with breakfast, at a place near work." });
      const results = await Promise.all([decideNoProof(a), decideNoProof(b)]);
      expect(results.map((d) => d.outcome).sort()).toEqual(["APPROVE", expect.stringMatching(/DENY|REVIEW/)].sort());
      expect(results.filter((d) => d.outcome === "APPROVE")).toHaveLength(1);
    });

    it("the settlement lock makes the second claim wait until the first has committed", async () => {
      const events: string[] = [];
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      let firstHasLock: () => void = () => undefined;
      const locked = new Promise<void>((r) => (firstHasLock = r));
      const first = withSettlementLock(pool, S.id, async () => {
        events.push("first has the lock");
        firstHasLock();
        await held;
        events.push("first done");
      });
      await locked;
      const second = withSettlementLock(pool, S.id, async () => {
        events.push("second has the lock");
      });
      const other = withSettlementLock(pool, "another-settlement", async () => {
        events.push("other settlement ran");
      });
      await other; // a different settlement never waits
      await new Promise((r) => setTimeout(r, 100));
      expect(events).toEqual(["first has the lock", "other settlement ran"]);
      release();
      await Promise.all([first, second]);
      expect(events).toEqual(["first has the lock", "other settlement ran", "first done", "second has the lock"]);
    });

    it("a match still undecided holds the later claim for a person, not an approval", async () => {
      const shared = { email: "same@example.com" };
      await add(shared); // filed, never decided
      const later = await add(shared);
      expect(await decideNoProof(later)).toMatchObject({ outcome: "REVIEW", check: "C8" });
    });
  });

  describe("claim states", () => {
    it("legal steps move; anything else is refused", async () => {
      expect(canMoveClaim("SUBMITTED", "EXAMINED")).toBe(true);
      expect(canMoveClaim("APPROVE", "SCHEDULED")).toBe(true);
      expect(canMoveClaim("DENY", "SCHEDULED")).toBe(false);
      expect(canMoveClaim("REVIEW", "SCHEDULED")).toBe(false);
      expect(canMoveClaim("SUBMITTED", "PAID")).toBe(false);
      expect(canMoveClaim("PAID", "CY_PRES_ELIGIBLE")).toBe(false);
      expect(canMoveClaim("CY_PRES_ELIGIBLE", "PAID")).toBe(false);
    });
    it("a stale move fails, so two workers cannot both act", async () => {
      const c = await add();
      await moveClaim(pool, c.id, "SUBMITTED", "EXAMINED");
      await expect(moveClaim(pool, c.id, "SUBMITTED", "EXAMINED")).rejects.toThrow("not in state");
    });
  });

  describe("money guards", () => {
    const approved = async () => {
      const c = await add();
      await moveClaim(pool, c.id, "SUBMITTED", "APPROVE");
      return c;
    };
    let batchNo = 100;
    const plan = async (claimIds: string[], over: Partial<{ senderBatchId: string; round: number }> = {}) => {
      batchNo++;
      const proposalId = await approvedProposal();
      const batch = { settlementId: S.id, kind: "CLAIMS" as const, round: over.round ?? batchNo, part: 1, senderBatchId: over.senderBatchId ?? `rs-test-${batchNo}`, proposalId, items: claimIds.map((id) => ({ senderItemId: id, claimId: id, receiver: `${id}@example.com`, cents: 1500 })) };
      return withTransaction(pool, (tx) => planBatch(tx, batch));
    };

    it("planning a batch stores it before any PayPal call, and schedules the claim", async () => {
      const c = await approved();
      const id = await plan([c.id]);
      expect((await getClaim(pool, c.id))?.status).toBe("SCHEDULED");
      expect(await payoutItemsOf(pool, id)).toEqual([{ senderItemId: c.id, claimId: c.id, receiver: `${c.id}@example.com`, cents: 1500, outcome: "PLANNED", paypalStatus: null, feeCents: null }]);
    });
    it("a batch ID can never be used twice, however much later", async () => {
      const a = await approved();
      const b = await approved();
      await plan([a.id], { senderBatchId: "rs-once" });
      await expect(plan([b.id], { senderBatchId: "rs-once" })).rejects.toThrow();
      expect((await getClaim(pool, b.id))?.status).toBe("APPROVE"); // rolled back: nothing scheduled
    });
    it("only an approved claim can be scheduled", async () => {
      const c = await add();
      await expect(plan([c.id])).rejects.toThrow("not in state APPROVE");
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM payout_items WHERE claim_id = $1", [c.id]);
      expect(rows[0].n).toBe(0);
    });
    it("a claim can hold only one live payout: the database refuses a second", async () => {
      const c = await approved();
      const first = await plan([c.id]);
      const { rows } = await pool.query("INSERT INTO payout_batches (settlement_id, kind, round, sender_batch_id, amount_cents, proposal_id) VALUES ($1, 'CLAIMS', 9999, 'rs-second', 1500, $2) RETURNING id", [S.id, await approvedProposal()]);
      const insertSecond = () => pool.query("INSERT INTO payout_items (batch_id, claim_id, sender_item_id, receiver, amount_cents) VALUES ($1, $2, $3, 'x@example.com', 1500)", [rows[0].id, c.id, c.id]);
      await expect(insertSecond()).rejects.toThrow("payout_items_one_live_per_claim");
      // Money that came back frees it, for a retry a person chooses.
      await recordItemRead(pool, { batchId: first, senderItemId: c.id, paypalItemId: "ITEM1", paypalStatus: "RETURNED", outcome: "RETURNED", feeCents: 25, error: null });
      await expect(insertSecond()).resolves.toBeDefined();
    });
    it("a zero or negative payout cannot be stored", async () => {
      const c = await approved();
      const batch = { settlementId: S.id, kind: "CLAIMS" as const, round: 8888, part: 1, senderBatchId: "rs-zero", proposalId: await approvedProposal(), items: [{ senderItemId: c.id, claimId: c.id, receiver: "x@example.com", cents: 0 }] };
      await expect(withTransaction(pool, (tx) => planBatch(tx, batch))).rejects.toThrow();
    });
    it("reads back what PayPal says; an unreported fee stays unknown", async () => {
      const c = await approved();
      const id = await plan([c.id], { senderBatchId: "rs-read" });
      await markBatchSent(pool, "rs-read", { paypalBatchId: "PB1", batchStatus: "PENDING", feesCents: null });
      await recordItemRead(pool, { batchId: id, senderItemId: c.id, paypalItemId: "I1", paypalStatus: "UNCLAIMED", outcome: "UNCLAIMED", feeCents: null, error: "RECEIVER_UNREGISTERED" });
      expect(await payoutItemsOf(pool, id)).toMatchObject([{ outcome: "UNCLAIMED", feeCents: null, paypalStatus: "UNCLAIMED" }]);
      await expect(markBatchSent(pool, "rs-nope", { paypalBatchId: "PB2", batchStatus: "PENDING", feesCents: null })).rejects.toThrow("no planned batch");
      await expect(recordItemRead(pool, { batchId: id, senderItemId: "ghost", paypalItemId: null, paypalStatus: null, outcome: "UNVERIFIED", feeCents: null, error: null })).rejects.toThrow("no payout item");
    });
    it("cy-près: one transfer per batch, approved by a named person", async () => {
      const proposalId = await approvedProposal("CY_PRES");
      const batchId = await withTransaction(pool, (tx) => planBatch(tx, { settlementId: S.id, kind: "CY_PRES", round: 1, part: 1, senderBatchId: "rs-cypres-1", proposalId, items: [{ senderItemId: "cypres-r1", claimId: null, receiver: S.cyPres.payoutEmail, cents: 500 }] }));
      const t = { settlementId: S.id, batchId, recipientName: S.cyPres.name, recipientEmail: S.cyPres.payoutEmail, cents: 500, approvedBy: "analyst:sam" };
      await withTransaction(pool, (tx) => recordCyPres(tx, t));
      await expect(withTransaction(pool, (tx) => recordCyPres(tx, t))).rejects.toThrow();
      const { rows } = await pool.query("SELECT actor FROM audit_log WHERE action = 'cy_pres_approved'");
      expect(rows).toEqual([{ actor: "analyst:sam" }]);
    });
  });

  describe("the app's database role", () => {
    const asApp = async <T>(fn: (c: Parameters<typeof appendAudit>[0]) => Promise<T>) =>
      withTransaction(pool, async (tx) => {
        await tx.query("SET LOCAL ROLE pushover_app");
        return fn(tx);
      });
    it("can read and write the new tables (0004 grants its own access)", async () => {
      await asApp(async (c) => {
        for (const t of ["settlements", "settlement_products", "claims", "claim_evidence", "findings", "decisions", "check_results", "payout_batches", "payout_items", "cy_pres_transfers", "analysts", "analyst_sessions", "money_proposals"]) {
          await expect(c.query(`SELECT count(*) FROM ${t}`)).resolves.toBeDefined();
        }
      });
      const a = await add();
      await withTransaction(pool, async (tx) => {
        await tx.query("SET LOCAL ROLE pushover_app");
        await moveClaim(tx, a.id, "SUBMITTED", "EXAMINED");
        await appendAudit(tx, { actor: "system", action: "test", subject: a.id, detail: {} });
      });
    });
    it("cannot rewrite a decision or the audit log", async () => {
      await expect(asApp((c) => c.query("UPDATE decisions SET reason = 'x'"))).rejects.toThrow(/permission denied/);
      await expect(asApp((c) => c.query("DELETE FROM check_results"))).rejects.toThrow(/permission denied/);
      await expect(asApp((c) => c.query("UPDATE audit_log SET actor = 'x'"))).rejects.toThrow(/permission denied/);
    });
  });

  it("an end-to-end proof claim: image hash, findings, checks, decision, all from the database", async () => {
    const sharp = (await import("sharp")).default;
    const raw = Buffer.alloc(64 * 64, 200);
    for (let i = 0; i < raw.length; i += 7) raw[i] = i % 255;
    const png = await sharp(raw, { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();
    const rotations = await hashRotations(png);
    const c = await add({ tier: "proof", unitsClaimed: 5, declaration: "A coffee and a coke with lunch in Long Beach." });
    await insertEvidence(pool, { claimId: c.id, contentType: "image/png", bytes: png, sha256: "c".repeat(64), phash: rotations[0] as string });
    await insertFindings(pool, { claimId: c.id, model: "claude-haiku-5-5", status: "OK", findings, costUsd: 0 });
    const stored = await latestFindings(pool, c.id);
    const d = await withSettlementLock(pool, S.id, async (tx) => {
      const out = runChecks(
        { claimId: c.id, tier: "proof", unitsClaimed: c.unitsClaimed, claimantState: c.state, identity: c, declaration: c.declaration },
        { settlement: S, table: loadTaxTable(), config: PROVISIONAL_CONFIG, findings: stored?.findings as Findings, imageRotations: rotations, earlierImages: await earlierImageHashes(tx, S.id, c.seq),
          earlierReceipts: [], earlierIdentities: await earlierIdentities(tx, S.id, c.seq), declarations: [{ claimId: c.id, text: c.declaration }], arrivals: await allArrivals(tx, S.id) },
      );
      const decision = decide(S, { tier: "proof", unitsClaimed: c.unitsClaimed, unitsEvidenced: out.unitsEvidenced, examiner: { status: "OK", confidence: "high" }, checks: out.checks });
      await recordDecision(tx, { claimId: c.id, from: c.status, decision, checks: out.checks, decidedBy: "system" });
      return decision;
    });
    expect(d).toMatchObject({ outcome: "APPROVE", units: 2, unitsClaimed: 5, entitlementCents: 3000 });
    expect(await latestDecision(pool, c.id)).toMatchObject({ units: 2, entitlementCents: 3000 });
  });

  describe("PayPal identity (migration 0005)", () => {
    const dana = { payerId: "QYR5Z8XDVJNXQ", verified: true, emailVerified: true };

    it("stores the logged-in account and reads it back", async () => {
      const c = await add({ paypal: dana });
      expect((await getClaim(pool, c.id))?.paypal).toEqual(dana);
      expect((await add()).paypal).toBeNull();
    });

    it("one PayPal account files one claim per settlement", async () => {
      await add({ paypal: { ...dana, payerId: "ABCDEFGHJKLM2" } });
      await expect(add({ paypal: { ...dana, payerId: "ABCDEFGHJKLM2" } })).rejects.toThrow(/claims_one_per_paypal_account/);
    });

    it("refuses a payer ID PayPal could not have issued", async () => {
      await expect(add({ paypal: { ...dana, payerId: "not-an-id" } })).rejects.toThrow(/check constraint/);
    });

    it("a payout item records whether it pays an email or a PayPal account", async () => {
      const c = await add({ paypal: { ...dana, payerId: "ZZZZZZZZZZZZ9" } });
      await withSettlementLock(pool, S.id, (tx) => tx.query("UPDATE claims SET status = 'APPROVE' WHERE id = $1", [c.id]));
      const proposalId = await approvedProposal();
      const batchId = await withTransaction(pool, (tx) =>
        planBatch(tx, { settlementId: S.id, kind: "CLAIMS", round: 90, part: 1, senderBatchId: "rs-identity-r90-p1", proposalId, items: [{ senderItemId: c.id, claimId: c.id, receiver: "ZZZZZZZZZZZZ9", cents: 100, recipientType: "PAYPAL_ID" }] }),
      );
      const { rows } = await pool.query("SELECT recipient_type FROM payout_items WHERE batch_id = $1", [batchId]);
      expect(rows[0]?.recipient_type).toBe("PAYPAL_ID");
    });
  });

  describe("analysts and two-person approval (0006)", () => {
    const raw = (sql: string, params: unknown[] = []) => pool.query(sql, params);
    const propose = (kind: "CLAIMS" | "CY_PRES" = "CY_PRES", by = proposer, ttlMinutes = 60) =>
      withTransaction(pool, (tx) => insertProposal(tx, { settlementId: S.id, kind, planHash: Buffer.alloc(32, 3), plan: { n: 1 }, totalCents: 900, by, ttlMinutes }));

    it("nobody approves their own proposal, even by writing to the table directly", async () => {
      const id = await propose("CY_PRES", supervisor);
      await expect(withTransaction(pool, (tx) => decideProposal(tx, { id, status: "APPROVED", by: supervisor }))).rejects.toThrow(/money_proposals_check/);
      await expect(raw("UPDATE money_proposals SET status = 'APPROVED', decided_by = proposed_by, decided_at = now() WHERE id = $1", [id])).rejects.toThrow();
      expect((await getProposal(pool, id))?.status).toBe("PROPOSED");
    });

    it("only a supervisor can approve", async () => {
      const other = await insertAnalyst(pool, { email: "lee@example.com", name: "Lee", role: "analyst", passwordHash: "scrypt$test" });
      const id = (await openProposal(pool, S.id, "CY_PRES"))?.id ?? (await propose());
      await expect(withTransaction(pool, (tx) => decideProposal(tx, { id, status: "APPROVED", by: other }))).rejects.toThrow("only an enabled supervisor");
    });

    it("an expired proposal can't be approved, and a new proposal supersedes the open one", async () => {
      const old = await openProposal(pool, S.id, "CY_PRES");
      const id = await propose("CY_PRES", proposer, 60);
      expect((await getProposal(pool, old?.id ?? -1))?.status).toBe("SUPERSEDED");
      await raw("UPDATE money_proposals SET proposed_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1", [id]);
      await expect(withTransaction(pool, (tx) => decideProposal(tx, { id, status: "APPROVED", by: supervisor }))).rejects.toThrow("expired");
    });

    it("a decided proposal never changes again", async () => {
      const id = await propose("CY_PRES");
      expect(await withTransaction(pool, (tx) => decideProposal(tx, { id, status: "CANCELLED", by: proposer }))).toBe(true);
      expect(await withTransaction(pool, (tx) => decideProposal(tx, { id, status: "APPROVED", by: supervisor }))).toBe(false);
      await expect(raw("UPDATE money_proposals SET status = 'PROPOSED', decided_by = NULL, decided_at = NULL WHERE id = $1", [id])).rejects.toThrow("already CANCELLED");
    });

    it("only one proposal per settlement and kind is open at a time", async () => {
      await propose("CY_PRES");
      await expect(raw("INSERT INTO money_proposals (settlement_id, kind, plan_hash, plan, total_cents, proposed_by, expires_at) VALUES ($1, 'CY_PRES', $2, '{}', 1, $3, now() + interval '1 hour')",
        [S.id, Buffer.alloc(32), proposer.id])).rejects.toThrow("money_proposals_one_open");
    });

    it("a payout batch needs an approved proposal of the same settlement and kind", async () => {
      const insert = (proposalId: number | null, kind = "CLAIMS") =>
        raw("INSERT INTO payout_batches (settlement_id, kind, round, sender_batch_id, amount_cents, proposal_id) VALUES ($1, $2, 777, $3, 100, $4)", [S.id, kind, `guard-${Math.random()}`, proposalId]);
      await expect(insert(null)).rejects.toThrow("has no approved proposal");
      const open = await openProposal(pool, S.id, "CY_PRES");
      await expect(insert(open?.id ?? -1, "CY_PRES")).rejects.toThrow("has no approved proposal");
      const claims = await approvedProposal("CLAIMS");
      await expect(insert(claims, "CY_PRES")).rejects.toThrow("has no approved proposal");
      const { rows } = await insert(claims, "CLAIMS");
      expect(rows).toEqual([]);
      await expect(raw("UPDATE payout_batches SET proposal_id = NULL WHERE round = 777")).rejects.toThrow("cannot change");
    });

    it("a session opens nothing once expired, logged out, or for a disabled analyst", async () => {
      const live = Buffer.alloc(32, 1);
      const old = Buffer.alloc(32, 2);
      await insertSession(pool, { tokenHash: live, analystId: proposer.id, expiresAt: new Date(Date.now() + 60_000) });
      await raw("INSERT INTO analyst_sessions (token_hash, analyst_id, created_at, expires_at) VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 hour')", [old, proposer.id]);
      expect(await sessionAnalyst(pool, live)).toEqual(proposer);
      expect(await sessionAnalyst(pool, old)).toBeNull();
      expect(await sessionAnalyst(pool, Buffer.alloc(32, 9))).toBeNull();
      await raw("UPDATE analysts SET disabled = true WHERE id = $1", [proposer.id]);
      expect(await sessionAnalyst(pool, live)).toBeNull();
      expect(await analystForLogin(pool, proposer.email)).toBeNull();
      await raw("UPDATE analysts SET disabled = false WHERE id = $1", [proposer.id]);
      await deleteSession(pool, live);
      expect(await sessionAnalyst(pool, live)).toBeNull();
    });

    it("counts failed logins by email and by network from the audit log", async () => {
      for (const network of ["n1", "n1", "n2"]) await appendAudit(pool, { actor: "anonymous", action: "login_failed", subject: "who@example.com", detail: { network } });
      expect(await recentFailedLogins(pool, { email: "who@example.com", network: "n1", minutes: 15 })).toEqual({ byEmail: 3, byNetwork: 2 });
      expect(await recentFailedLogins(pool, { email: "else@example.com", network: null, minutes: 15 })).toEqual({ byEmail: 0, byNetwork: 0 });
    });

    it("refuses an email with capitals or no @, and a password that isn't a scrypt hash", async () => {
      await expect(insertAnalyst(pool, { email: "Big@example.com", name: "B", role: "analyst", passwordHash: "scrypt$x" })).rejects.toThrow(/check constraint/);
      await expect(insertAnalyst(pool, { email: "nobody", name: "B", role: "analyst", passwordHash: "scrypt$x" })).rejects.toThrow(/check constraint/);
      await expect(insertAnalyst(pool, { email: "plain@example.com", name: "B", role: "analyst", passwordHash: "hunter2" })).rejects.toThrow(/check constraint/);
    });
  });
});
