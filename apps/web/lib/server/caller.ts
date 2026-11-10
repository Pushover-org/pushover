// Who is calling the assistants' endpoints, as much as they need: the site's origin (to build the
// links they hand to a person) and a keyed hash of the caller's network (for the rate limit). The
// raw IP address is never stored or logged.
import { ipPrefixKey } from "@proofofclaim/checks";
import type { NextRequest } from "next/server";

export function caller(req: NextRequest | Request): { origin: string; network: string | null } {
  const url = new URL(req.url);
  const origin = process.env["PUBLIC_ORIGIN"] ?? url.origin;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return { origin, network: ip ? ipPrefixKey(ip, process.env["NETWORK_SECRET"] ?? "demo-network-secret") : null };
}
