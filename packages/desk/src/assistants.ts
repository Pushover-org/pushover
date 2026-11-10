// Claims an assistant files for a person (plan items P11, P13, P14, C14).
//
// An assistant may fill in the form and attach the receipt. That makes an UNBOUND filing, not a
// claim: it isn't read, checked, decided, counted against anyone else's claim, or paid. It becomes a
// claim only when its person opens the confirm link, logs in with PayPal and confirms it, and from
// then on it is exactly a claim filed on the form: the same reader, the same checks, the same table,
// paid only to the PayPal account that confirmed it (migration 0013 enforces that too).
//
// Nothing here confirms on anyone's behalf: confirmFiling needs the identity PayPal returned at login.
import { createHash, randomBytes } from "node:crypto";
import { hashRotations, ipPrefixKey } from "@proofofclaim/checks";
import { appendAudit, bindClaim, claimIdByConfirmToken, getClaim, getEvidence, insertClaim, insertEvidence, lapseClaim, unboundFiledBefore, withTransaction, type ClaimRow } from "@proofofclaim/db";
import { sniffImageType } from "@proofofclaim/examiner";
import { ClaimRejectedError, decideClaim, filingOpenForDecisions, newStatusToken, readEvidence, statusTokenHash, type Desk, type DeskDecision } from "./desk.ts";
import { pseudonymOf, sealPayerId } from "./payer-id.ts";
import { signalKeys } from "./rings.ts";

/** How long an assistant's filing waits for its person before it lapses (or the filing deadline, if sooner). */
export const UNBOUND_DAYS = 7;
const DAY_MS = 86_400_000;

export interface AssistantFiling {
  /** What the assistant says it is called. Shown as its own words, never as verified. */
  agentName: string;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  name: string;
  /**
   * Optional, and the public API never sends it: the person's PayPal email replaces it when they
   * confirm, so an assistant never has to hand over anyone's email address.
   */
  email?: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  declaration: string;
  image: Uint8Array | null;
}

/** A confirm link's token: 24 random bytes. Only its SHA-256 is stored. */
const newConfirmToken = () => randomBytes(24).toString("base64url");
const confirmTokenHash = (token: string): Buffer => createHash("sha256").update(token).digest();
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

function lapsesAt(desk: Pick<Desk, "settlement">, filedAt: Date): Date {
  const week = new Date(filedAt.getTime() + UNBOUND_DAYS * DAY_MS);
  const closes = desk.settlement.filing ? new Date(desk.settlement.filing.closesAt) : null;
  return closes && closes < week ? closes : week;
}

/**
 * Stores an assistant's filing as UNBOUND, with its receipt (hashed now, so its person's claim is
 * compared with the photo they actually sent; read only once they confirm, so an unconfirmed filing
 * spends no AI credit). The tokens are returned once, here, and never stored.
 */
export async function fileForPerson(desk: Desk, f: AssistantFiling, now = new Date()): Promise<{ claim: ClaimRow; confirmToken: string; statusToken: string; lapsesAt: Date }> {
  const closes = desk.settlement.filing ? new Date(desk.settlement.filing.closesAt) : null;
  if (closes && now > closes) throw new ClaimRejectedError(`Filing for this settlement closed on ${closes.toISOString().slice(0, 10)}.`, "closed");
  if (f.tier === "proof" && !f.image) throw new ClaimRejectedError("A claim with proof needs a photo of the receipt.", "no_receipt");
  const type = f.image ? sniffImageType(f.image) : null;
  if (f.image && !type) throw new ClaimRejectedError("The receipt must be a JPEG, PNG, GIF or WebP photo.", "not_image");
  const phash = f.image ? await hashRotations(f.image).then((r) => r[0] ?? null, () => null) : null;
  const confirmToken = newConfirmToken();
  const statusToken = newStatusToken();
  const id = `poc-${randomBytes(6).toString("hex")}`;
  const claim = await withTransaction(desk.pool, async (c) => {
    const claim = await insertClaim(c, {
      id, settlementId: desk.settlement.id, tier: f.tier, unitsClaimed: f.tier === "proof" ? f.unitsClaimed : 1, name: f.name, email: f.email ?? "",
      addressLine: f.addressLine, city: f.city, state: f.state, zip: f.zip, declaration: f.declaration,
      // The assistant's own servers are not the person's network: C9 gets the person's at confirmation.
      ipKey: null, paypal: null, statusTokenHash: statusTokenHash(statusToken),
      signals: signalKeys(desk, { email: f.email ?? "", addressLine: f.addressLine, zip: f.zip, deviceId: null }),
      assistant: { agentName: f.agentName, confirmTokenHash: confirmTokenHash(confirmToken) },
    });
    if (f.image && type) await insertEvidence(c, { claimId: claim.id, contentType: type, bytes: f.image, sha256: createHash("sha256").update(f.image).digest("hex"), phash });
    await appendAudit(c, { actor: "assistant", action: "assistant_filed", subject: claim.id, detail: { agentName: f.agentName, tier: f.tier, receipt: !!f.image } });
    return claim;
  });
  return { claim, confirmToken, statusToken, lapsesAt: lapsesAt(desk, claim.agentFiledAt ?? now) };
}

/** The settlement an UNBOUND filing belongs to, from its confirm link (null if none is waiting). */
export async function settlementOfConfirmLink(pool: Desk["pool"], token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const id = await claimIdByConfirmToken(pool, confirmTokenHash(token));
  return id ? ((await getClaim(pool, id))?.settlementId ?? null) : null;
}

/** What the confirm page shows its person: what was filed in their name, and by which assistant. */
export interface FilingToConfirm {
  claimId: string;
  agentName: string;
  agentFiledAt: Date;
  lapsesAt: Date;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  declaration: string;
  hasReceipt: boolean;
}

/** The UNBOUND filing behind a confirm link, or null (unknown, used, lapsed, or past its window). */
export async function filingToConfirm(desk: Desk, token: string, now = new Date()): Promise<FilingToConfirm | null> {
  if (!TOKEN.test(token)) return null;
  const id = await claimIdByConfirmToken(desk.pool, confirmTokenHash(token));
  const c = id ? await getClaim(desk.pool, id) : null;
  if (!c || c.status !== "UNBOUND" || !c.agentName || !c.agentFiledAt || c.settlementId !== desk.settlement.id) return null;
  const until = lapsesAt(desk, c.agentFiledAt);
  if (now > until) return null;
  const evidence = await getEvidence(desk.pool, c.id);
  return {
    claimId: c.id, agentName: c.agentName, agentFiledAt: c.agentFiledAt, lapsesAt: until, tier: c.tier, unitsClaimed: c.unitsClaimed,
    name: c.name, addressLine: c.addressLine, city: c.city, state: c.state, zip: c.zip, declaration: c.declaration, hasReceipt: evidence.length > 0,
  };
}

export interface ConfirmingPerson {
  /** From Log in with PayPal, never from the assistant. */
  paypal: { payerId: string; email: string; verified: boolean; emailVerified: boolean | null };
  ip: string | null;
  deviceId: string | null;
}

/**
 * Its person confirms an assistant's filing. From here on it is an ordinary claim: one per PayPal
 * account, read by the examiner, checked and decided like a claim from the form. Returns a fresh
 * private status link; the assistant's link stops working, because the claim is now the person's.
 */
export async function confirmFiling(desk: Desk, token: string, who: ConfirmingPerson, now = new Date()): Promise<{ claim: ClaimRow; result: DeskDecision | null; statusToken: string }> {
  const keys = desk.keys;
  if (!keys) throw new Error("confirming a claim needs PAYER_SEAL_KEY and PAYER_PSEUDONYM_KEY");
  const filing = await filingToConfirm(desk, token, now);
  if (!filing) throw new ClaimRejectedError("This confirm link has expired or was already used.", "link_expired");
  const s = desk.settlement;
  const statusToken = newStatusToken();
  let claim: ClaimRow | null;
  try {
    claim = await withTransaction(desk.pool, async (c) => {
      const bound = await bindClaim(c, {
        claimId: filing.claimId, confirmTokenHash: confirmTokenHash(token),
        paypal: { pseudonym: pseudonymOf(keys, s.id, who.paypal.payerId), sealed: sealPayerId(keys, s.id, filing.claimId, who.paypal.payerId), verified: who.paypal.verified, emailVerified: who.paypal.emailVerified },
        email: who.paypal.email, ipKey: who.ip ? ipPrefixKey(who.ip, desk.networkSecret) : null,
        signals: (({ deviceKey, inboxKey }) => ({ deviceKey, inboxKey }))(signalKeys(desk, { email: who.paypal.email, addressLine: filing.addressLine, zip: filing.zip, deviceId: who.deviceId })),
        statusTokenHash: statusTokenHash(statusToken),
      });
      if (bound) await appendAudit(c, { actor: "claimant", action: "assistant_filing_confirmed", subject: filing.claimId, detail: { agentName: filing.agentName, paypalVerified: who.paypal.verified } });
      return bound;
    });
  } catch (err) {
    if (err instanceof Error && /claims_one_per_paypal_account/.test(err.message)) throw new ClaimRejectedError("This PayPal account has already filed a claim in this settlement.", "already_filed");
    throw err;
  }
  if (!claim) throw new ClaimRejectedError("This confirm link has expired or was already used.", "link_expired");
  // Exactly what the claim form does after filing.
  await readEvidence(desk, claim.id);
  const result = filingOpenForDecisions(desk, now) ? null : await decideClaim(desk, claim.id);
  return { claim, result, statusToken };
}

/** Its person says the filing isn't theirs (or is wrong): it lapses for good. Nothing about money can follow. */
export async function disownFiling(desk: Desk, token: string, now = new Date()): Promise<boolean> {
  const filing = await filingToConfirm(desk, token, now);
  if (!filing) return false;
  return withTransaction(desk.pool, async (c) => {
    const done = await lapseClaim(c, filing.claimId);
    if (done) await appendAudit(c, { actor: "claimant", action: "assistant_filing_disowned", subject: filing.claimId, detail: { agentName: filing.agentName } });
    return done;
  });
}

/** The worker: filings nobody confirmed within the window (or by the filing deadline) lapse. */
export async function lapseUnconfirmed(desk: Desk, now = new Date()): Promise<number> {
  const closes = desk.settlement.filing ? new Date(desk.settlement.filing.closesAt) : null;
  const cutoff = closes && now > closes ? new Date(8.64e15) : new Date(now.getTime() - UNBOUND_DAYS * DAY_MS);
  let lapsed = 0;
  for (const id of await unboundFiledBefore(desk.pool, desk.settlement.id, cutoff)) {
    await withTransaction(desk.pool, async (c) => {
      if (await lapseClaim(c, id)) {
        lapsed++;
        await appendAudit(c, { actor: "worker", action: "assistant_filing_lapsed", subject: id, detail: { days: UNBOUND_DAYS } });
      }
    });
  }
  return lapsed;
}
