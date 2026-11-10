// What an assistant can do, once: the MCP tools (app/api/mcp) and the JSON API (app/api/v1) both
// call these, so the two can't drift apart in behaviour, only in transport.
//
// Three things, and only three: list settlements, file a claim for a person (it waits UNBOUND for
// them), read a claim's progress. Nothing here confirms, decides, approves or pays; the import
// boundary test (apps/web/lib/api/boundary.test.ts) fails if this file or the MCP server reaches for
// code that does.
import { parseSettlement, REASONS, type ReasonCode, type Settlement } from "@proofofclaim/claims";
import { assistantFilingsSince, PgRateLimiter, type ClaimState } from "@proofofclaim/db";
import { claimByStatusToken, ClaimRejectedError, fileForPerson } from "@proofofclaim/desk";
import type { z } from "zod";
import { CLAIMANT_STATE, claimantState, expectedAmount } from "../claim-status.ts";
import type { ClaimStatusResult, FileClaimInput, FileClaimResult, ListSettlementsResult, SettlementSummary } from "../api/schemas.ts";
import { MAX_IMAGE_BYTES } from "../api/schemas.ts";
import { claimView, desk, pool } from "./data.ts";

export type ApiFailure = { ok: false; status: number; code: string; error: string; retryAfterSeconds?: number };
export type ApiResult<T> = { ok: true; value: T } | ApiFailure;
const failure = (status: number, code: string, error: string, extra: Partial<ApiFailure> = {}): ApiFailure => ({ ok: false, status, code, error, ...extra });

/** Per network (a keyed hash, never the raw IP), per minute; and per settlement, per hour. */
export const LIMITS = { callsPerMinute: 60, filingsPerMinute: 10, filingsPerSettlementPerHour: 300 } as const;

/** Refuses a caller that has used its minute's budget. Every tool call and API request counts. */
export async function admit(network: string | null, kind: "call" | "filing"): Promise<ApiFailure | null> {
  const who = network ?? "unknown";
  const perMinute = kind === "filing" ? LIMITS.filingsPerMinute : LIMITS.callsPerMinute;
  const r = await new PgRateLimiter(pool(), { key: `assistant:${kind}:${who}`, perMinute }).allow();
  return r.ok ? null : failure(429, "rate_limited", "Too many requests from this network. Try again shortly.", { retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000) });
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function summary(S: Settlement, origin: string): z.infer<typeof SettlementSummary> {
  const products = S.products.map((p) => p.name.toLowerCase()).join(" or ");
  return {
    id: S.id, name: S.name, demo: S.demo,
    who_qualifies: `Anyone who bought a ${products} in ${S.geography.states.join(", ")} between ${S.classPeriod.start} and ${S.classPeriod.end}. ` +
      `With a receipt: ${usd(S.tiers.proof.unitCents)} per item, up to ${S.tiers.proof.maxUnits}. Without one: ${usd(S.tiers.noProof.flatCents)}. ` +
      "Amounts are a share of the fund. One claim per person.",
    class_period: { start: S.classPeriod.start, end: S.classPeriod.end },
    states: [...S.geography.states],
    products: S.products.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    tiers: { proof: { unit_cents: S.tiers.proof.unitCents, max_units: S.tiers.proof.maxUnits }, no_proof: { flat_cents: S.tiers.noProof.flatCents } },
    filing_closes_at: S.filing?.closesAt ?? null,
    claim_url: new URL(`/claim/${S.id}`, origin).toString(),
  };
}

/** Settlements still taking claims. */
export async function listSettlements(origin: string, now = new Date()): Promise<z.infer<typeof ListSettlementsResult>> {
  const { rows } = await pool().query<{ config: unknown }>("SELECT config FROM settlements ORDER BY created_at DESC NULLS LAST, id");
  const open = rows.flatMap((r) => {
    try {
      const S = parseSettlement(r.config);
      return !S.filing || new Date(S.filing.closesAt) > now ? [S] : [];
    } catch {
      return [];
    }
  });
  return { settlements: open.map((S) => summary(S, origin)) };
}

/** Files a claim for a person. It waits UNBOUND until they confirm it with PayPal. */
export async function fileClaimForPerson(input: FileClaimInput, ctx: { origin: string; network: string | null }): Promise<ApiResult<z.infer<typeof FileClaimResult>>> {
  const busy = await admit(ctx.network, "filing");
  if (busy) return busy;
  const D = await desk(input.settlement);
  if (!D) return failure(404, "no_settlement", "There is no settlement with that ID. list_settlements shows the open ones.");
  if (input.tier === "proof" && !input.receipt) return failure(400, "no_receipt", "The proof tier needs the receipt photo. File as no_proof if the person has no receipt.");
  let image: Uint8Array | null = null;
  if (input.receipt) {
    image = new Uint8Array(Buffer.from(input.receipt.data_base64, "base64"));
    if (image.byteLength === 0) return failure(400, "no_receipt", "The receipt photo is empty.");
    if (image.byteLength > MAX_IMAGE_BYTES) return failure(413, "too_big", "The receipt photo is over 8 MB.");
  }
  const hourAgo = new Date(Date.now() - 3_600_000);
  if ((await assistantFilingsSince(pool(), D.settlement.id, hourAgo)) >= LIMITS.filingsPerSettlementPerHour) {
    return failure(429, "settlement_busy", "This settlement is taking too many assistant filings right now. The person can file themselves on the claim page.", { retryAfterSeconds: 600 });
  }
  try {
    const { claim, confirmToken, statusToken, lapsesAt } = await fileForPerson(D, {
      agentName: input.agent_name, tier: input.tier, unitsClaimed: input.tier === "proof" ? input.units : 1, name: input.name,
      addressLine: input.address_line, city: input.city, state: input.state, zip: input.zip, declaration: input.declaration, image,
    });
    return {
      ok: true,
      value: {
        claim_id: claim.id, state: "UNBOUND",
        confirm_url: new URL(`/confirm/${confirmToken}`, ctx.origin).toString(),
        lapses_at: lapsesAt.toISOString(),
        status_token: statusToken,
        status_url: new URL(`/status/${statusToken}`, ctx.origin).toString(),
        next_step:
          `Give the person the confirm_url. They log in with PayPal, check what you filed and swear to it; only then is it read, checked and decided. ` +
          `You cannot confirm it for them. If nobody confirms it by ${lapsesAt.toISOString().slice(0, 10)}, it closes.`,
      },
    };
  } catch (err) {
    if (err instanceof ClaimRejectedError) return failure(err.code === "closed" ? 409 : 400, err.code ?? "rejected", err.message);
    throw err;
  }
}

/** A claim's progress, by its private status token. Nothing personal: no name, address, email or PayPal details. */
export async function claimStatus(token: string, origin: string): Promise<z.infer<typeof ClaimStatusResult> | null> {
  const id = await claimByStatusToken({ pool: pool() }, token);
  const v = id ? await claimView(id) : null;
  const D = v ? await desk(v.settlementId) : null;
  if (!v || !D) return null;
  const state = claimantState(v.status as ClaimState, v.paypalVerified);
  const words = CLAIMANT_STATE[state];
  return {
    claim_id: v.id, settlement: v.settlementId, state, title: words.title, detail: words.detail,
    outcome: v.outcome, reason: v.reason && v.reason in REASONS ? REASONS[v.reason as ReasonCode] : null,
    expected_amount: expectedAmount({ tier: v.tier, entitlementCents: v.entitlementCents, units: v.units, approved: v.outcome === "APPROVE" }, D.settlement.tiers),
    filed_by: { via: v.filedVia, agent_name: v.agentName, confirmed_at: v.boundAt },
    status_url: new URL(`/status/${token}`, origin).toString(),
  };
}
