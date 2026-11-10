// Files a claim from the claim form: the claimant must have logged in with PayPal. The desk reads
// the receipt, runs the checks and decides; this route only collects and validates the input.
import { US_STATES } from "@proofofclaim/claims";
import { ClaimRejectedError, submitClaim } from "@proofofclaim/desk";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { desk } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const Form = z.object({
  settlement: z.string().regex(/^[a-z0-9-]{1,64}$/),
  tier: z.enum(["proof", "no_proof"]),
  units: z.coerce.number().int().min(1).max(50),
  name: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(3).max(200),
  city: z.string().trim().max(100),
  state: z.enum(US_STATES),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "a 5-digit ZIP code"),
  declaration: z.string().trim().min(20, "a declaration of at least 20 characters").max(2000),
  sworn: z.literal("yes", { message: "the declaration must be sworn" }),
});

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const identity = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!identity) return fail("Log in with PayPal first, so your payment goes to your own account.", 401);

  const data = await req.formData().catch(() => null);
  if (!data) return fail("The form could not be read.");
  const parsed = Form.safeParse(Object.fromEntries([...data.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`Please check ${issue?.path.join(".") || "the form"}: ${issue?.message ?? "invalid"}.`);
  }
  const f = parsed.data;
  const file = data.get("receipt");
  let image: Uint8Array | null = null;
  if (f.tier === "proof") {
    if (!(file instanceof File) || file.size === 0) return fail("Add a photo of your receipt, or file without one.");
    if (file.size > MAX_IMAGE_BYTES) return fail("That photo is over 8 MB. Try a smaller one.");
    image = new Uint8Array(await file.arrayBuffer());
  }

  const d = await desk(f.settlement);
  if (!d) return fail("This settlement doesn't exist.", 404);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const { claim, result } = await submitClaim(d, {
      tier: f.tier, unitsClaimed: f.tier === "proof" ? f.units : 1, name: f.name, email: identity.email, addressLine: f.addressLine, city: f.city, state: f.state, zip: f.zip,
      declaration: f.declaration, ip, image, paypal: { payerId: identity.payerId, verified: identity.verified, emailVerified: identity.emailVerified },
    });
    return NextResponse.json({ id: claim.id, outcome: result?.decision.outcome ?? null });
  } catch (err) {
    if (err instanceof ClaimRejectedError) return fail(err.message, 409);
    throw err;
  }
}
