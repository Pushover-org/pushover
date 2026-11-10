// Log in with PayPal (docs/architecture.md → Claimant identity; fields verified in the sandbox,
// docs/sandbox-findings.md). The access token is used once to read userinfo and then dropped:
// it carries the app's whole scope list, so it is never stored or logged.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { paypalCredentials } from "@proofofclaim/paypal";
import { z } from "zod";

const SCOPES = "openid profile email address https://uri.paypal.com/services/paypalattributes";
export const STATE_COOKIE = "poc_login_state";
export const IDENTITY_COOKIE = "poc_identity";

/** The URL PayPal sends the claimant back to; it must match the app's Return URL in the dashboard. */
export function returnUrl(origin: string): string {
  return process.env["PAYPAL_LOGIN_RETURN_URL"] ?? `${origin}/api/paypal/callback`;
}

export function authorizeUrl(state: string, redirect: string): string {
  const env = paypalCredentials("guarded");
  const web = env.baseUrl.replace("api-m.", "www.");
  const q = new URLSearchParams({ flowEntry: "static", client_id: env.clientId, response_type: "code", scope: SCOPES, redirect_uri: redirect, state });
  return `${web}/connect?${q}`;
}

export const newState = () => randomBytes(16).toString("hex");

const UserInfo = z.object({
  payer_id: z.string().regex(/^[2-9A-HJ-NP-Z]{13}$/),
  name: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  verified_account: z.union([z.boolean(), z.string()]).optional(),
  address: z.object({ street_address: z.string().optional(), locality: z.string().optional(), region: z.string().optional(), postal_code: z.string().optional(), country: z.string().optional() }).optional(),
});

export interface Identity {
  payerId: string;
  name: string;
  email: string;
  verified: boolean;
  emailVerified: boolean | null;
  address: { line: string; city: string; state: string; zip: string; country: string } | null;
}

/** Exchanges the one-time code and reads who logged in. Fails closed: no payer ID, no identity. */
export async function identityFromCode(code: string): Promise<Identity> {
  const env = paypalCredentials("guarded");
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
  const tok = await fetch(`${env.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    // Exactly what the sandbox test sent (scripts/identity/try-login.ts).
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
  });
  const t = (await tok.json().catch(() => ({}))) as { access_token?: string };
  if (!tok.ok || !t.access_token) throw new Error(`PayPal token exchange failed (HTTP ${tok.status})`);
  const res = await fetch(`${env.baseUrl}/v1/identity/openidconnect/userinfo?schema=openid`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const u = UserInfo.safeParse(await res.json().catch(() => null));
  if (!res.ok || !u.success) throw new Error(`PayPal userinfo had no usable payer ID (HTTP ${res.status})`);
  const a = u.data.address;
  return {
    payerId: u.data.payer_id,
    name: u.data.name ?? "",
    email: u.data.email ?? "",
    verified: u.data.verified_account === true || u.data.verified_account === "true",
    emailVerified: u.data.email_verified ?? null,
    address: a ? { line: a.street_address ?? "", city: a.locality ?? "", state: a.region ?? "", zip: a.postal_code ?? "", country: a.country ?? "" } : null,
  };
}

// The identity rides in a signed, httpOnly cookie for the length of one claim.
const g = globalThis as unknown as { __pocSessionKey?: string };
function key(): string {
  const k = process.env["SESSION_SECRET"];
  if (k) return k;
  if (process.env["NODE_ENV"] === "production") throw new Error("missing environment variable SESSION_SECRET");
  g.__pocSessionKey ??= randomBytes(32).toString("hex");
  return g.__pocSessionKey;
}

export function sealIdentity(i: Identity): string {
  const body = Buffer.from(JSON.stringify(i)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}

export function openIdentity(v: string | undefined): Identity | null {
  if (!v) return null;
  const [body, mac] = v.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Identity;
  } catch {
    return null;
  }
}
