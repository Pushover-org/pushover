// Files a claim from the claim form: the claimant must have logged in with PayPal. The desk reads
// the receipt, runs the checks and decides; this route only collects and validates the input.
import { randomBytes } from "node:crypto";
import { ClaimRejectedError, submitClaim } from "@proofofclaim/desk";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ClaimFormSchema, MAX_IMAGE_BYTES } from "@/lib/api/schemas.ts";
import { desk } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";

const DEVICE_COOKIE = "poc_device";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const identity = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!identity) return fail("Log in with PayPal first, so your payment goes to your own account.", 401);

  const data = await req.formData().catch(() => null);
  if (!data) return fail("The form could not be read.");
  const parsed = ClaimFormSchema.safeParse(Object.fromEntries([...data.entries()].filter(([, v]) => typeof v === "string")));
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
  // A random ID this browser keeps (P25): claims from one device link up. Only its keyed hash is stored.
  const jar = await cookies();
  const known = jar.get(DEVICE_COOKIE)?.value;
  const deviceId = known && /^[A-Za-z0-9_-]{22}$/.test(known) ? known : randomBytes(16).toString("base64url");
  try {
    const { claim, result, statusToken } = await submitClaim(d, {
      tier: f.tier, unitsClaimed: f.tier === "proof" ? f.units : 1, name: f.name, email: identity.email, addressLine: f.addressLine, city: f.city, state: f.state, zip: f.zip,
      declaration: f.declaration, ip, image, paypal: { payerId: identity.payerId, verified: identity.verified, emailVerified: identity.emailVerified }, deviceId,
    });
    // The private status link's token is returned once, here, and never stored.
    const res = NextResponse.json({ id: claim.id, outcome: result?.decision.outcome ?? null, statusToken });
    if (known !== deviceId) res.cookies.set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 400 * 86_400 });
    return res;
  } catch (err) {
    if (err instanceof ClaimRejectedError) return fail(err.message, 409);
    throw err;
  }
}
