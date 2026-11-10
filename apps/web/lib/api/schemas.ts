// The claim API's shapes, in one place (plan items P12, P15). The claim form's route, the MCP tools
// and the OpenAPI document are all built from these: change a field here and all three change, and
// the drift test (schemas.test.ts) fails until the published OpenAPI file is regenerated.
//
// No shape here can confirm, decide, approve or pay a claim. Those happen only after a person logs
// in with PayPal (confirming) or an analyst signs in (deciding), never through this API.
import { US_STATES } from "@proofofclaim/claims";
import { z } from "zod";

/** Per network (a keyed hash, never the raw IP), per minute; and per settlement, per hour. Published in the OpenAPI document. */
export const LIMITS = { callsPerMinute: 60, filingsPerMinute: 10, filingsPerSettlementPerHour: 300 } as const;

/** The most a receipt photo may weigh, for every claimant: the form and the assistants alike. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

// One rule per field, shared by the form and the assistants' API.
const field = {
  settlement: z.string().regex(/^[a-z0-9-]{1,64}$/).describe("The settlement's ID, from list_settlements."),
  tier: z.enum(["proof", "no_proof"]).describe("proof: with a receipt photo, paid per qualifying item. no_proof: without one, a flat amount."),
  name: z.string().trim().min(2).max(120).describe("The person's full name."),
  addressLine: z.string().trim().min(3).max(200).describe("Street address."),
  city: z.string().trim().max(100).describe("City."),
  state: z.enum(US_STATES).describe("Two-letter US state code."),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "a 5-digit ZIP code").describe("5-digit ZIP code."),
  declaration: z
    .string()
    .trim()
    .min(20, "a declaration of at least 20 characters")
    .max(2000)
    .describe("In the person's own words: what they bought, where and when. Template wording is held for a person to check."),
};

/** The claim form (multipart, camelCase). The claimant swears to it on the form. */
export const ClaimFormSchema = z.object({
  settlement: field.settlement,
  tier: field.tier,
  units: z.coerce.number().int().min(1).max(50),
  name: field.name,
  addressLine: field.addressLine,
  city: field.city,
  state: field.state,
  zip: field.zip,
  declaration: field.declaration,
  sworn: z.literal("yes", { message: "the declaration must be sworn" }),
});

/**
 * An assistant filing for a person (JSON, snake_case; the MCP tool file_claim and POST /api/v1/claims).
 * There is no "sworn" field on purpose: an assistant can't swear for anyone. The person swears to the
 * declaration on the confirm page, after logging in with PayPal.
 */
export const FileClaimInput = z.object({
  settlement: field.settlement,
  agent_name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}]+$/u, "plain text")
    .describe("The name you, the assistant, go by (for example the product's name). It is shown to the person and the claims staff as the name you gave."),
  tier: field.tier,
  units: z.int().min(1).max(50).default(1).describe("proof tier: how many qualifying items the person bought (capped by what the receipt shows). Ignored for no_proof."),
  name: field.name,
  address_line: field.addressLine,
  city: field.city,
  state: field.state,
  zip: field.zip,
  declaration: field.declaration,
  receipt: z
    .object({
      content_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
      data_base64: z.base64().max(MAX_BASE64).describe("The photo's bytes, base64-encoded. At most 8 MB before encoding."),
    })
    .optional()
    .describe("The receipt photo. Required for the proof tier. It is read and checked like any other claim's, once the person confirms."),
});
export type FileClaimInput = z.infer<typeof FileClaimInput>;

export const ClaimStatusInput = z.object({
  status_token: z.string().regex(/^[A-Za-z0-9_-]{32}$/).describe("The status_token file_claim returned. It stops working once the person confirms, because the claim is theirs from then on."),
});

export const ListSettlementsInput = z.object({});

const Cents = z.int().nonnegative();

export const SettlementSummary = z.object({
  id: z.string(),
  name: z.string(),
  demo: z.boolean().describe("True for a fictional demo settlement, paid in PayPal sandbox play money."),
  who_qualifies: z.string().describe("Plain-words eligibility: what, where and when."),
  class_period: z.object({ start: z.iso.date(), end: z.iso.date() }),
  states: z.array(z.enum(US_STATES)),
  products: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  tiers: z.object({
    proof: z.object({ unit_cents: Cents, max_units: z.int().positive() }),
    no_proof: z.object({ flat_cents: Cents }),
  }),
  filing_closes_at: z.iso.datetime().nullable(),
  claim_url: z.url().describe("Where a person can file by themselves."),
});

export const ListSettlementsResult = z.object({ settlements: z.array(SettlementSummary) });

export const FileClaimResult = z.object({
  claim_id: z.string(),
  state: z.literal("UNBOUND").describe("Filed, waiting for the person. Not read, checked, decided or payable until they confirm."),
  confirm_url: z.url().describe("Give this link to the person. They log in with PayPal and confirm the claim is theirs. You can't do this step for them."),
  lapses_at: z.iso.datetime().describe("If nobody confirms by then, the filing closes for good."),
  status_token: z.string().describe("For claim_status. Keep it private; it shows the claim's progress, nothing personal."),
  status_url: z.url(),
  next_step: z.string(),
});

export const ClaimStatusResult = z.object({
  claim_id: z.string(),
  settlement: z.string(),
  state: z.string().describe("UNBOUND, LAPSED, SUBMITTED, EXAMINED, APPROVE, WAITING_VERIFICATION, GROUP_HELD, DENY, NEED_MORE, REVIEW, SCHEDULED, PAID, UNCLAIMED, RETURNED, FAILED, CY_PRES_ELIGIBLE or UNVERIFIED."),
  title: z.string(),
  detail: z.string(),
  outcome: z.enum(["APPROVE", "DENY", "NEED_MORE", "REVIEW"]).nullable().describe("The latest decision by the published rules or a person; null while undecided."),
  reason: z.string().nullable().describe("Why, in the words on the court's record."),
  expected_amount: z.object({ amount: z.string(), basis: z.string() }),
  filed_by: z.object({
    via: z.enum(["FORM", "ASSISTANT"]),
    agent_name: z.string().nullable().describe("The name the assistant gave itself. Not verified."),
    confirmed_at: z.iso.datetime().nullable(),
  }),
  status_url: z.url(),
});

export const ApiError = z.object({
  error: z.string().describe("A sentence that can be shown to the person."),
  code: z.string().describe("A short machine-readable code."),
});

/** Every shape the API publishes, by the name it has in the OpenAPI document. */
export const API_SCHEMAS = {
  FileClaimRequest: FileClaimInput,
  FileClaimResult,
  ClaimStatusRequest: ClaimStatusInput,
  ClaimStatusResult,
  ListSettlementsResult,
  SettlementSummary,
  ApiError,
} as const;
