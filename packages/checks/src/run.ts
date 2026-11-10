// Runs every check that applies to a claim. Pure: everything from the database and the image
// arrives as an argument, and a failed lookup is passed as null, which gives UNKNOWN, never PASS.
import { CHECKS_FOR_TIER, type CheckId, type CheckResult, type Findings, type Settlement, type Tier } from "@proofofclaim/claims";
import { checkTemplate, checkVelocity, templateClusters, type Arrival, type Declaration, type TemplateConfig, type VelocityConfig } from "./clusters.ts";
import { checkArithmetic, checkClassPeriod, checkGeography, checkQualifyingProduct, checkRepeatDetails, checkUnitsCap, checkVisualAnomaly, unitsEvidenced, type ReceiptDetails } from "./evidence.ts";
import { checkIdentity, type EarlierIdentity, type Identity } from "./identity.ts";
import { checkDuplicateImage, type ImageHash } from "./image-hash.ts";
import { checkTax, type TaxTable } from "./tax.ts";

export interface CheckConfig {
  imageMaxDistance: number;
  taxMarginPct: number;
  template: TemplateConfig;
  velocity: VelocityConfig;
}

/**
 * Provisional. Spec §5.4: N, T, K and M are tuned on the dev slice only, never on the test set.
 * R8 records the values the pilot uses.
 */
export const PROVISIONAL_CONFIG: CheckConfig = {
  imageMaxDistance: 4,
  taxMarginPct: 2,
  template: { shingle: 3, threshold: 0.5, minOthers: 3 },
  velocity: { maxClaims: 5, hours: 24 },
};

export interface ClaimFacts {
  claimId: string;
  tier: Tier;
  unitsClaimed: number;
  claimantState: string | null;
  identity: Identity | null;
  declaration: string | null;
}

export interface CheckContext {
  settlement: Settlement;
  table: TaxTable;
  config: CheckConfig;
  /** Null for a no-proof claim, or when the examiner produced nothing usable. */
  findings: Findings | null;
  /** hashRotations of this claim's image. */
  imageRotations: string[] | null;
  earlierImages: ImageHash[] | null;
  earlierReceipts: ReceiptDetails[] | null;
  earlierIdentities: EarlierIdentity[] | null;
  /** Every claim in the settlement, this one included. */
  declarations: Declaration[] | null;
  arrivals: Arrival[] | null;
}

export interface CheckOutput {
  checks: CheckResult[];
  unitsEvidenced: number | undefined;
}

export function runChecks(claim: ClaimFacts, ctx: CheckContext): CheckOutput {
  const { settlement: s, findings: f, config } = ctx;
  const notRead = (id: CheckId): CheckResult => ({ id, result: "UNKNOWN", detail: "evidence not read" });
  const sizes = ctx.declarations === null ? null : templateClusters(ctx.declarations, config.template);
  const all: Record<CheckId, () => CheckResult> = {
    C1: () => (f ? checkClassPeriod(f, s) : notRead("C1")),
    C2: () => (f ? checkQualifyingProduct(f, s) : notRead("C2")),
    C3: () => (f ? checkArithmetic(f) : notRead("C3")),
    C4: () => (f ? checkTax(f, ctx.table, config.taxMarginPct) : notRead("C4")),
    C5: () => checkGeography(claim.claimantState, f, s, claim.tier),
    C6: () => checkDuplicateImage(claim.claimId, ctx.imageRotations, ctx.earlierImages, config.imageMaxDistance),
    C7: () => checkTemplate(claim.claimId, claim.declaration, sizes, config.template),
    C8: () => checkIdentity(claim.claimId, claim.identity, ctx.earlierIdentities),
    C9: () => checkVelocity(claim.claimId, ctx.arrivals, config.velocity),
    C10: () => (f ? checkVisualAnomaly(f) : notRead("C10")),
    C11: () => checkUnitsCap(claim.unitsClaimed, f, s, claim.tier),
    C12: () => (f ? checkRepeatDetails(claim.claimId, f, ctx.earlierReceipts) : notRead("C12")),
  };
  return {
    checks: CHECKS_FOR_TIER[claim.tier].map((id) => all[id]()),
    unitsEvidenced: claim.tier === "proof" && f ? unitsEvidenced(f, s) : undefined,
  };
}
