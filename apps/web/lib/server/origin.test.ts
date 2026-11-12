// Redirects must go to the address people use, not the container's (the live login sent people to
// https://localhost:8080 before this, 2026-11-12).
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./origin.ts";

afterEach(() => vi.unstubAllEnvs());

describe("publicOrigin", () => {
  const req = new NextRequest("https://localhost:8080/api/paypal/callback?code=x");

  it("uses PUBLIC_ORIGIN when the deployment sets it", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://claims.example.org/");
    expect(publicOrigin(req)).toBe("https://claims.example.org");
  });

  it("falls back to the request's origin (local dev, e2e)", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "");
    expect(publicOrigin(req)).toBe("https://localhost:8080");
  });
});
