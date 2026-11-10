import { describe, expect, it } from "vitest";
import { ClaimStatusInput, FileClaimInput } from "../api/schemas.ts";
import { readJson } from "./json-api.ts";

const req = (body: unknown, ct = "application/json") => new Request("http://x.test/api/v1/claims", { method: "POST", headers: { "content-type": ct }, body: typeof body === "string" ? body : JSON.stringify(body) });
const filing = {
  settlement: "acme-restaurant-beverage", agent_name: "Helper", tier: "no_proof", name: "Lena Park", address_line: "12 Birch Rd", city: "Lansing", state: "MI", zip: "48933",
  declaration: "I had a lemonade with lunch at a diner in Lansing in summer 2017.",
};

describe("reading a JSON body against the shared schemas", () => {
  it("accepts a valid filing and fills the defaults", async () => {
    const r = await readJson(req(filing), FileClaimInput);
    expect(r.ok && r.value.units).toBe(1);
  });

  it("refuses an unknown field with a sentence an assistant can act on, never ignores it", async () => {
    const r = await readJson(req({ ...filing, sworn: true }), FileClaimInput);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      expect(await r.response.json()).toEqual({ code: "unknown_field", error: "Unknown field: sworn. Only the person can swear to or confirm a claim, on the confirm page." });
    }
    expect((await readJson(req({ status_token: "A".repeat(32), claim: "x" }), ClaimStatusInput)).ok).toBe(false);
  });

  it("says a photo over 8 MB is over 8 MB", async () => {
    const big = "A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4);
    const r = await readJson(req({ ...filing, tier: "proof", receipt: { content_type: "image/jpeg", data_base64: big } }), FileClaimInput);
    expect(!r.ok && (await r.response.json()).error).toMatch(/the photo is over 8 MB/);
  });

  it("refuses a body that isn't JSON, or isn't sent as JSON", async () => {
    const a = await readJson(req("{nope"), FileClaimInput);
    expect(!a.ok && a.response.status).toBe(400);
    const b = await readJson(req("settlement=x", "application/x-www-form-urlencoded"), FileClaimInput);
    expect(!b.ok && b.response.status).toBe(415);
  });
});
