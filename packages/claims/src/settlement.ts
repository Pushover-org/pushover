import { z } from "zod";

/** The 50 states plus DC (class geography is in US states, spec §1.3). */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;
export type UsState = (typeof US_STATES)[number];

const cents = z.int().positive();
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and dashes");

export const SettlementSchema = z
  .strictObject({
    id: slug,
    name: z.string().min(3).max(200),
    /** Demo settlements must say so in their name (spec rule 8: no fake real-world entities). */
    demo: z.boolean(),
    currency: z.literal("USD"),
    fundCents: cents,
    /** Held back from the fund before allocation (spec §4.5). */
    adminReserveCents: z.int().nonnegative(),
    classPeriod: z.strictObject({ start: z.iso.date(), end: z.iso.date() }),
    products: z
      .array(z.strictObject({ id: slug, name: z.string().min(1).max(200), description: z.string().max(1000) }))
      .min(1),
    geography: z.strictObject({ states: z.array(z.enum(US_STATES)).min(1) }),
    tiers: z.strictObject({
      proof: z.strictObject({ unitCents: cents, maxUnits: z.int().min(1).max(1000) }),
      noProof: z.strictObject({ flatCents: cents }),
    }),
    cyPres: z.strictObject({ name: z.string().min(3).max(200), payoutEmail: z.email() }),
    /**
     * Plan item P19. Claims are refused after `closesAt`. With `decideAfterClose`, claims are read
     * as they arrive but decided together once filing closes, so cluster checks see every claim.
     * Optional: without it, filing stays open and claims are decided as they arrive.
     */
    filing: z.strictObject({ closesAt: z.iso.datetime(), decideAfterClose: z.boolean() }).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.classPeriod.start > s.classPeriod.end) ctx.addIssue({ code: "custom", path: ["classPeriod"], message: "start is after end" });
    if (s.adminReserveCents >= s.fundCents) ctx.addIssue({ code: "custom", path: ["adminReserveCents"], message: "reserve must be less than the fund" });
    if (new Set(s.products.map((p) => p.id)).size !== s.products.length) ctx.addIssue({ code: "custom", path: ["products"], message: "duplicate product id" });
    if (new Set(s.geography.states).size !== s.geography.states.length) ctx.addIssue({ code: "custom", path: ["geography", "states"], message: "duplicate state" });
    if (s.demo && !/\(fictional demo\)/i.test(s.name)) ctx.addIssue({ code: "custom", path: ["name"], message: 'a demo settlement name must include "(fictional demo)"' });
    if (s.demo && !/\(fictional demo\)|\(demo\)/i.test(s.cyPres.name)) ctx.addIssue({ code: "custom", path: ["cyPres", "name"], message: 'a demo cy-pres recipient name must include "(demo)"' });
    if (s.tiers.noProof.flatCents > s.tiers.proof.unitCents * s.tiers.proof.maxUnits) {
      ctx.addIssue({ code: "custom", path: ["tiers", "noProof"], message: "the no-proof amount cannot exceed the most a proof claim can get" });
    }
  });

export type Settlement = z.infer<typeof SettlementSchema>;

export function parseSettlement(input: unknown): Settlement {
  return SettlementSchema.parse(input);
}
