// The address people reach the app at. Behind Railway's proxy the request's own origin is the
// container's (https://localhost:8080), so redirects built from it send people nowhere. Set
// PUBLIC_ORIGIN on a deployment (docs/deploy.md); without it (local dev, e2e) the request's origin is right.
import type { NextRequest } from "next/server";

export function publicOrigin(req: NextRequest): string {
  const configured = process.env["PUBLIC_ORIGIN"]?.replace(/\/+$/, "");
  return configured || req.nextUrl.origin;
}
