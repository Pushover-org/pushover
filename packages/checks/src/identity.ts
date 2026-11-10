// C8: one claim per person, address and payout email.
import type { CheckResult } from "@proofofclaim/claims";

export interface Identity {
  name: string;
  email: string;
  addressLine: string;
  zip: string;
}

/** APPROVED counts as a duplicate. PENDING may yet be approved. CLOSED (denied) does not count. */
export type EarlierStatus = "APPROVED" | "PENDING" | "CLOSED";

export interface EarlierIdentity extends Identity {
  claimId: string;
  status: EarlierStatus;
}

export function normaliseEmail(e: string): string {
  const [local = "", domain = ""] = e.trim().toLowerCase().split("@");
  return `${local.split("+")[0]}@${domain}`;
}

const STREET: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", court: "ct", place: "pl",
  apartment: "apt", unit: "apt", suite: "ste", north: "n", south: "s", east: "e", west: "w", highway: "hwy",
};

export function normaliseAddress(line: string, zip: string): string {
  const t = line.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map((w) => STREET[w] ?? w);
  return `${t.join(" ")}|${zip.trim().slice(0, 5)}`;
}

/** Word order and case do not matter: "Reyes, Dana" is "Dana Reyes". */
export function normaliseNameZip(name: string, zip: string): string {
  const t = name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).sort();
  return `${t.join(" ")}|${zip.trim().slice(0, 5)}`;
}

function matchesOn(a: Identity, b: Identity): string[] {
  const why: string[] = [];
  if (normaliseEmail(a.email) === normaliseEmail(b.email)) why.push("payout email");
  if (normaliseAddress(a.addressLine, a.zip) === normaliseAddress(b.addressLine, b.zip)) why.push("address");
  if (normaliseNameZip(a.name, a.zip) === normaliseNameZip(b.name, b.zip)) why.push("name and ZIP");
  return why;
}

export function checkIdentity(claimId: string, me: Identity | null, earlier: EarlierIdentity[] | null): CheckResult {
  if (me === null || earlier === null) return { id: "C8", result: "UNKNOWN", detail: "identity lookup failed" };
  let pending: string | null = null;
  for (const e of earlier) {
    if (e.claimId === claimId || e.status === "CLOSED") continue;
    const why = matchesOn(me, e);
    if (why.length === 0) continue;
    if (e.status === "APPROVED") return { id: "C8", result: "FAIL", detail: `same ${why.join(", ")} as approved claim ${e.claimId}` };
    pending ??= `same ${why.join(", ")} as claim ${e.claimId}, not yet decided`;
  }
  return pending ? { id: "C8", result: "UNKNOWN", detail: pending } : { id: "C8", result: "PASS", detail: "no match" };
}
