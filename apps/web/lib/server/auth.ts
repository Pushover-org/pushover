// Analyst sessions for the admin screens (docs/architecture.md → Admin login). Every admin page,
// server action and admin API route calls requireAnalyst() or currentAnalyst() itself: a layout
// alone is not enough, because Next.js does not re-run layouts on every navigation.
// test/admin-guard.test.ts fails if one is missed.
import { ipPrefixKey } from "@proofofclaim/checks";
import type { Analyst } from "@proofofclaim/db";
import { analystFromToken } from "@proofofclaim/desk";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "./data.ts";

export const ADMIN_COOKIE = "poc_admin";

export async function currentAnalyst(): Promise<Analyst | null> {
  return analystFromToken(pool(), (await cookies()).get(ADMIN_COOKIE)?.value);
}

/** The logged-in analyst, or a redirect to the login page that comes back to `returnTo`. */
export async function requireAnalyst(returnTo: string): Promise<Analyst> {
  const a = await currentAnalyst();
  if (!a) redirect(`/login?next=${encodeURIComponent(safeNext(returnTo))}`);
  return a;
}

/** Only same-site admin paths may be returned to after login. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/admin(\/[A-Za-z0-9._~%-]*)*(\?[A-Za-z0-9=&_%-]*)?$/.test(next) ? next : "/admin/acme-restaurant-beverage";
}

/** A keyed hash of the caller's network for counting failed logins. The raw IP is never stored. */
export async function callerNetwork(): Promise<string | null> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? ipPrefixKey(ip, process.env["NETWORK_SECRET"] ?? "demo-network-secret") : null;
}
