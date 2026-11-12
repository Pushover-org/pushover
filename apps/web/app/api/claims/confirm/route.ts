// The person's answer on the confirm page (plan item P13): "this is my claim" (after Log in with
// PayPal, sworn) or "this isn't mine". Only this route turns an assistant's filing into a claim, and
// it needs the identity PayPal returned at login: an assistant can't reach it on anyone's behalf.
import { randomBytes } from "node:crypto";
import { ClaimRejectedError, confirmFiling, disownFiling, settlementOfConfirmLink } from "@proofofclaim/desk";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { desk, pool } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

const DEVICE_COOKIE = "poc_device";

export async function POST(req: NextRequest) {
  const data = await req.formData().catch(() => null);
  const token = String(data?.get("token") ?? "");
  const action = String(data?.get("action") ?? "");
  const lang = String(data?.get("lang") ?? "");
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return new NextResponse("bad link", { status: 400 });
  const page = (q: Record<string, string>) => {
    const url = new URL(`/confirm/${token}`, publicOrigin(req));
    for (const [k, v] of Object.entries({ ...q, ...(/^(en|es|hi)$/.test(lang) ? { lang } : {}) })) url.searchParams.set(k, v);
    return NextResponse.redirect(url, 303);
  };

  const settlementId = await settlementOfConfirmLink(pool(), token);
  const D = settlementId ? await desk(settlementId) : null;
  if (!D) return page({ error: "link_expired" });

  if (action === "disown") {
    await disownFiling(D, token);
    const url = new URL(`/confirm/closed`, publicOrigin(req));
    if (/^(en|es|hi)$/.test(lang)) url.searchParams.set("lang", lang);
    return NextResponse.redirect(url, 303);
  }
  if (action !== "confirm") return new NextResponse("bad action", { status: 400 });

  const identity = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!identity) return page({ error: "login" });
  if (data?.get("sworn") !== "yes") return page({ error: "not_sworn" });
  if (!D.keys) return page({ error: "unavailable" });

  const jar = await cookies();
  const known = jar.get(DEVICE_COOKIE)?.value;
  const deviceId = known && /^[A-Za-z0-9_-]{22}$/.test(known) ? known : randomBytes(16).toString("base64url");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const { statusToken } = await confirmFiling(D, token, {
      paypal: { payerId: identity.payerId, email: identity.email, verified: identity.verified, emailVerified: identity.emailVerified }, ip, deviceId,
    });
    const url = new URL(`/status/${statusToken}`, publicOrigin(req));
    url.searchParams.set("confirmed", "1");
    if (/^(en|es|hi)$/.test(lang)) url.searchParams.set("lang", lang);
    const res = NextResponse.redirect(url, 303);
    if (known !== deviceId) res.cookies.set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 400 * 86_400 });
    return res;
  } catch (err) {
    if (err instanceof ClaimRejectedError) return page({ error: err.code ?? "link_expired" });
    throw err;
  }
}
