// What a claimant can do after a decision (plan items P9, C9, B3):
// - send the document the rules asked for (NEED_MORE), which the examiner reads and the rules decide
//   again, exactly as at filing;
// - appeal a denial or a hold, in their own words and optionally with a new document. An appeal
//   always goes to a person: a denied claim moves back to REVIEW, and the decision on record stays
//   until a person makes a new one. The model and the rules never decide an appeal.
import { createHash } from "node:crypto";
import { hashRotations } from "@proofofclaim/checks";
import { appendAudit, followupsOf, getClaim, insertEvidence, insertFindings, insertFollowup, listGroups, moveClaim, withSettlementLock, type ClaimState } from "@proofofclaim/db";
import { sniffImageType } from "@proofofclaim/examiner";
import { ClaimRejectedError, decideClaim, type Desk, type DeskDecision } from "./desk.ts";

export const MAX_APPEALS = 3;
export const MAX_DOCUMENTS = 3;
export const APPEAL_MIN_CHARS = 10;
export const APPEAL_MAX_CHARS = 2000;

async function evidenceOf(image: Uint8Array) {
  const type = sniffImageType(image);
  if (!type) throw new ClaimRejectedError("The document must be a JPEG, PNG, GIF or WebP photo.", "not_image");
  const phash = await hashRotations(image).then((r) => r[0] ?? null, () => null);
  return { contentType: type, bytes: image, sha256: createHash("sha256").update(image).digest("hex"), phash };
}

/** Is this claim in a linked group that is held for a person? */
async function inHeldGroup(desk: Desk, claimId: string): Promise<boolean> {
  const groups = await listGroups(desk.pool, desk.settlement.id, { activeOnly: true });
  return groups.some((g) => g.status === "HELD" && g.members.includes(claimId));
}

/** What a claimant may do now. The status page shows exactly these. */
export async function followupOptions(desk: Desk, claimId: string): Promise<{ canSendDocument: boolean; canAppeal: boolean; openAppeal: boolean; heldInGroup: boolean }> {
  const c = await getClaim(desk.pool, claimId);
  if (!c) return { canSendDocument: false, canAppeal: false, openAppeal: false, heldInGroup: false };
  const [past, heldInGroup] = await Promise.all([followupsOf(desk.pool, claimId), inHeldGroup(desk, claimId)]);
  const appeals = past.filter((f) => f.kind === "APPEAL");
  const openAppeal = appeals.some((f) => f.open);
  return {
    canSendDocument: c.status === "NEED_MORE" && c.tier === "proof" && past.filter((f) => f.kind === "DOCUMENT").length < MAX_DOCUMENTS,
    canAppeal: !openAppeal && appeals.length < MAX_APPEALS && (c.status === "DENY" || c.status === "REVIEW" || heldInGroup),
    openAppeal,
    heldInGroup,
  };
}

/**
 * The document the rules asked for. The examiner reads it, then the checks and the decision table
 * run again on it. Returns the new decision (null if the claim was decided meanwhile).
 */
export async function sendDocument(desk: Desk, claimId: string, image: Uint8Array): Promise<DeskDecision | null> {
  const opts = await followupOptions(desk, claimId);
  if (!opts.canSendDocument) throw new ClaimRejectedError("This claim isn't waiting for a document.", "not_waiting");
  const doc = await evidenceOf(image);
  const c = await getClaim(desk.pool, claimId);
  if (!c) throw new ClaimRejectedError("No such claim.", "not_waiting");
  // Read first (outside the lock: it can take seconds), then record everything at once.
  const read = desk.read ? await desk.read({ image: doc.bytes, declaration: c.declaration, products: desk.settlement.products }) : null;
  const moved = await withSettlementLock(desk.pool, desk.settlement.id, async (tx) => {
    const now = await getClaim(tx, claimId);
    if (now?.status !== "NEED_MORE") return false;
    const evidenceId = await insertEvidence(tx, { claimId, ...doc });
    await insertFollowup(tx, { claimId, kind: "DOCUMENT", fromStatus: "NEED_MORE", message: null, evidenceId });
    await insertFindings(tx, read
      ? { claimId, model: read.model, status: read.status, findings: read.status === "OK" ? read.findings : null, costUsd: read.costUsd }
      : { claimId, model: "none", status: "NOT_RUN", findings: null, costUsd: 0 });
    await moveClaim(tx, claimId, "NEED_MORE", "EXAMINED");
    await appendAudit(tx, { actor: "claimant", action: "document_sent", subject: claimId, detail: { evidence_id: evidenceId, examiner: read?.status ?? "NOT_RUN" } });
    return true;
  });
  return moved ? decideClaim(desk, claimId) : null;
}

/**
 * An appeal, in the claimant's words, optionally with a new document for the person deciding it.
 * A denied claim goes back to a person (DENY -> REVIEW); a held claim stays held, with the appeal
 * beside it. Returns the claim's state afterwards.
 */
export async function appealClaim(desk: Desk, claimId: string, a: { message: string; image?: Uint8Array | null }): Promise<ClaimState> {
  const message = a.message.trim();
  if (message.length < APPEAL_MIN_CHARS) throw new ClaimRejectedError("Tell the person reviewing it what was missed, in a sentence or two.", "too_short");
  if (message.length > APPEAL_MAX_CHARS) throw new ClaimRejectedError(`Keep the appeal under ${APPEAL_MAX_CHARS} characters.`, "too_long");
  const opts = await followupOptions(desk, claimId);
  if (opts.openAppeal) throw new ClaimRejectedError("Your appeal is already with a person.", "already_open");
  if (!opts.canAppeal) throw new ClaimRejectedError("This claim can't be appealed now.", "not_now");
  const doc = a.image && a.image.length > 0 ? await evidenceOf(a.image) : null;
  return withSettlementLock(desk.pool, desk.settlement.id, async (tx) => {
    const c = await getClaim(tx, claimId);
    if (!c) throw new ClaimRejectedError("No such claim.", "not_now");
    if (!(c.status === "DENY" || c.status === "REVIEW" || opts.heldInGroup)) throw new ClaimRejectedError("This claim can't be appealed now.", "not_now");
    const evidenceId = doc ? await insertEvidence(tx, { claimId, ...doc }) : null;
    await insertFollowup(tx, { claimId, kind: "APPEAL", fromStatus: c.status, message, evidenceId });
    let status: ClaimState = c.status;
    if (c.status === "DENY") {
      await moveClaim(tx, claimId, "DENY", "REVIEW");
      status = "REVIEW";
    }
    await appendAudit(tx, { actor: "claimant", action: "appeal", subject: claimId, detail: { from: c.status, to: status, with_document: evidenceId !== null, chars: message.length } });
    return status;
  });
}
