// Checks Log in with PayPal on the sandbox before the claim form relies on it: which fields
// userinfo really returns (user_id? payer_id? verified_account?). Two steps, from the repo root:
//   1. node --env-file-if-exists=.env.local scripts/identity/try-login.ts url
//      Prints the login link. Open it, log in as a sandbox buyer, and copy the address you land on.
//   2. node --env-file-if-exists=.env.local scripts/identity/try-login.ts code '<that address>'
//      Exchanges the code and prints which fields each userinfo path returns. Tokens are never printed;
//      the payer_id is saved to PAYER_ID_FILE for pay-payer-id.ts.
// Needs Log in with PayPal enabled on the guarded sandbox app, with RETURN_URL as its Return URL.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { paypalCredentials } from "../../packages/paypal/src/env.ts";

/** Git-ignored; scripts/identity/pay-payer-id.ts pays this account. */
export const PAYER_ID_FILE = ".data/identity/payer-id.txt";
const RETURN_URL = "https://example.com/rightfulshare/paypal-callback";
const SCOPES = "openid profile email address https://uri.paypal.com/services/paypalattributes";
const env = paypalCredentials("guarded");
const web = env.baseUrl.replace("api-m.", "www.");
const [step, landed] = process.argv.slice(2);

if (step === "url") {
  const q = new URLSearchParams({ flowEntry: "static", client_id: env.clientId, response_type: "code", scope: SCOPES, redirect_uri: RETURN_URL, state: randomBytes(8).toString("hex") });
  console.log(`${web}/connect?${q}`);
} else if (step === "code" && landed) {
  const code = new URL(landed).searchParams.get("code");
  if (!code) throw new Error("no code in that address");
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
  const tok = await fetch(`${env.baseUrl}/v1/oauth2/token`, {
    method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
  });
  const body = (await tok.json()) as { access_token?: string; scope?: string; error?: string; error_description?: string };
  console.log(`token: HTTP ${tok.status}${body.error ? ` ${body.error}: ${body.error_description}` : ""}; scope granted: ${body.scope ?? "-"}`);
  if (!body.access_token) process.exit(1);
  const mask = (v: unknown): unknown => (typeof v === "string" ? (v.length > 6 ? `${v.slice(0, 3)}…${v.slice(-2)} (${v.length} chars)` : v) : v);
  for (const path of ["/v1/identity/openidconnect/userinfo?schema=openid", "/v1/identity/oauth2/userinfo?schema=paypalv1.1"]) {
    const r = await fetch(`${env.baseUrl}${path}`, { headers: { Authorization: `Bearer ${body.access_token}` } });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(`\n${path}: HTTP ${r.status}`);
    // Objects (address, emails) are shown by their keys only: a real login's address is personal data.
    if (typeof j.payer_id === "string") {
      mkdirSync(".data/identity", { recursive: true });
      writeFileSync(PAYER_ID_FILE, j.payer_id + "\n");
    }
    for (const [k, v] of Object.entries(j)) console.log(`  ${k}: ${v && typeof v === "object" ? `{${Object.keys(Array.isArray(v) ? (v[0] ?? {}) : v).join(", ")}}` : String(mask(v))}`);
  }
} else {
  console.log("usage: try-login.ts url | try-login.ts code '<address you landed on>'");
}
