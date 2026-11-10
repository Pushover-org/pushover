// Assistants file claims for people (plan items P11–P15, C14), through the real app: a real MCP
// client over Streamable HTTP files a claim with the receipt photo; it waits UNBOUND; the person logs
// in with PayPal (a cookie signed with the e2e session secret, as in claims.spec.ts: PayPal's
// authorize page refuses our localhost callback) and confirms it; then the receipt is checked and
// the rules decide, exactly as for a claim from the form.
//
// The e2e run has no receipt reader (no API key), so a confirmed receipt claim is decided REVIEW
// "the receipt hasn't been read", rule 0 of the table. Nothing here is approved, so the money test in
// claims.spec.ts (which counts approved claims) is unaffected whichever file runs first.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "./env.ts";

process.env["SESSION_SECRET"] = E2E.sessionSecret;
const { IDENTITY_COOKIE, sealIdentity } = await import("../lib/server/paypal-login.ts");

const S = E2E.settlement;
const PHOTO = readFileSync(new URL("./fixtures/unreadable-photo.jpg", import.meta.url));
const AGENT = "E2E Assistant";

async function mcp(): Promise<Client> {
  const client = new Client({ name: "e2e-assistant", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", E2E.baseURL)));
  return client;
}

type Filed = { claim_id: string; state: string; confirm_url: string; status_token: string; lapses_at: string };
const filing = (over: Record<string, unknown> = {}) => ({
  settlement: S, agent_name: AGENT, tier: "proof", units: 2, name: "Priya Natarajan", address_line: "41 Lark St", city: "Albany", state: "NY", zip: "12210",
  declaration: "Two lemonades with dinner at a diner on Lark Street in Albany, June 2018. The receipt is attached.",
  receipt: { content_type: "image/jpeg", data_base64: PHOTO.toString("base64") },
  ...over,
});

/** The person, logged in with PayPal, on their own network. */
async function person(browser: Browser, who: { payerId: string; name: string; ip: string; viewport?: { width: number; height: number } }): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": who.ip }, ...(who.viewport ? { viewport: who.viewport } : {}) });
  const value = sealIdentity({
    payerId: who.payerId, name: who.name, email: `${who.payerId.toLowerCase()}@personal.example.com`, verified: true, emailVerified: true,
    address: { line: "41 Lark St", city: "Albany", state: "NY", zip: "12210", country: "US" },
  });
  await ctx.addCookies([{ name: IDENTITY_COOKIE, value, url: E2E.baseURL, httpOnly: true }]);
  return ctx.newPage();
}

async function analyst(browser: Browser, next: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(next);
  await page.waitForURL(/\/login\?next=/);
  await page.locator('input[name="email"]').fill(E2E.analyst.email);
  await page.locator('input[name="password"]').fill(E2E.analyst.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${E2E.baseURL}${next}`);
  return page;
}

async function expectAccessible(page: Page, what: string) {
  await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== "running" || x.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("nextjs-portal").analyze();
  expect(r.violations.map((v) => `${what}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ") ?? ""}`)).toEqual([]);
}

test.describe.serial("an assistant files for a person; only the person makes it a claim", () => {
  let filed: Filed;

  test("an MCP client sees three tools, lists settlements and files a receipt claim; it waits UNBOUND (P12, C14)", async () => {
    const client = await mcp();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["claim_status", "file_claim", "list_settlements"]);
    const list = await client.callTool({ name: "list_settlements", arguments: {} });
    expect((list.structuredContent as { settlements: { id: string }[] }).settlements.map((s) => s.id)).toContain(S);

    const r = await client.callTool({ name: "file_claim", arguments: filing() });
    expect(r.isError).toBeFalsy();
    filed = r.structuredContent as Filed;
    expect(filed.state).toBe("UNBOUND");
    expect(filed.confirm_url).toMatch(new RegExp(`^${E2E.baseURL}/confirm/[A-Za-z0-9_-]{32}$`));

    const status = await client.callTool({ name: "claim_status", arguments: { status_token: filed.status_token } });
    expect(status.structuredContent).toMatchObject({ claim_id: filed.claim_id, state: "UNBOUND", outcome: null, filed_by: { via: "ASSISTANT", agent_name: AGENT, confirmed_at: null } });
    // Stateless: no stream to open and no session to end (the SDK client copes with 405 by design).
    for (const method of ["GET", "DELETE"]) expect((await fetch(new URL("/api/mcp", E2E.baseURL), { method })).status, method).toBe(405);
    // The JSON twin of claim_status says the same.
    const rest = await fetch(new URL("/api/v1/claims/status", E2E.baseURL), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status_token: filed.status_token }) });
    expect(await rest.json()).toMatchObject({ claim_id: filed.claim_id, state: "UNBOUND" });
    await client.close();
  });

  test("the published OpenAPI document describes the same three operations", async () => {
    const doc = (await (await fetch(new URL("/api/openapi.json", E2E.baseURL))).json()) as { openapi: string; paths: Record<string, Record<string, { operationId: string }>> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId)).sort()).toEqual(["claimStatus", "fileClaim", "listSettlements"]);
  });

  test("the analysts see it waiting for its person, with the name the assistant gave (P14, P11)", async ({ browser }) => {
    const desk = await analyst(browser, `/admin/${S}`);
    await desk.getByRole("tab", { name: /Waiting for its person/ }).click();
    const row = desk.locator(".ag-row").filter({ hasText: filed.claim_id });
    await expect(row).toContainText(`"${AGENT}" · waiting`);
    await expect(row).toContainText("unconfirmed");
    // Nothing was checked, so nothing may read as passed.
    await expect(row).toContainText("not checked yet");
    await expect(row).not.toContainText("all pass");
    // It is not a claim yet: the public report doesn't list it.
    const report = await desk.request.get(`/api/report/${S}`);
    expect(await report.text()).not.toContain(filed.claim_id);
  });

  test("nobody but the person can confirm: without a PayPal login the confirm is refused", async ({ browser }) => {
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(new URL(filed.confirm_url).pathname);
    await expect(anon.getByRole("heading", { name: "Is this claim yours?" })).toBeVisible();
    await expect(anon.getByText(`gave its name as “${AGENT}”`)).toBeVisible();
    await expect(anon.getByRole("button", { name: "This is my claim" })).toBeDisabled();
    // Even posting the form directly is refused without the identity PayPal's login sets.
    const token = new URL(filed.confirm_url).pathname.split("/").at(-1) ?? "";
    const r = await anon.request.post("/api/claims/confirm", { form: { token, action: "confirm", sworn: "yes" }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    expect(r.headers()["location"]).toContain("error=login");
  });

  test("the person logs in with PayPal and confirms: the receipt is checked and the rules decide (C14, P13)", async ({ browser }) => {
    const page = await person(browser, { payerId: "E2EASSTPRF234", name: "Priya Natarajan", ip: "203.0.113.10" });
    await page.goto(new URL(filed.confirm_url).pathname);
    await expect(page.getByText(/^Logged in as Priya Natarajan/)).toBeVisible();
    await expect(page.getByText("Attached. It is read and checked only after you confirm.")).toBeVisible();
    await page.locator('input[name="sworn"]').check();
    await page.getByRole("button", { name: "This is my claim" }).click();
    await page.waitForURL(/\/status\/[A-Za-z0-9_-]{32}\?confirmed=1/);
    await expect(page.getByText("Confirmed. This is now your claim")).toBeVisible();
    // Decided by the table: with no reader in e2e, rule 0 holds the receipt for a person.
    await expect(page.getByRole("heading", { name: "Held for a person" })).toBeVisible();
    await expect(page.getByText(`An assistant that gave its name as “${AGENT}”; you confirmed it with PayPal`)).toBeVisible();

    // The claim is the person's now: the assistant's link stops working.
    const client = await mcp();
    const old = await client.callTool({ name: "claim_status", arguments: { status_token: filed.status_token } });
    expect(old.isError).toBe(true);
    await client.close();

    // On the desk: the same checks as any claim, decided by the rules, and who filed it.
    const desk = await analyst(browser, `/admin/${S}/claim/${filed.claim_id}`);
    await expect(desk.getByText(`An assistant that gave its name as "${AGENT}", confirmed by its person with PayPal`)).toBeVisible();
    await expect(desk.getByText("A person decides this one.")).toBeVisible();
    await expect(desk.getByText("EXAMINER_NOT_RUN")).toBeVisible();
    const photo = await desk.request.get(`/api/evidence/${filed.claim_id}`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()["content-type"]).toBe("image/jpeg");
  });

  test("a confirmed claim from outside the class states is denied by the rules, like anyone's", async ({ browser }) => {
    const r = await fetch(new URL("/api/v1/claims", E2E.baseURL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filing({ tier: "no_proof", receipt: undefined, name: "Omar Haddad", address_line: "9 High St", city: "Columbus", state: "OH", zip: "43004", declaration: "A ginger ale at a diner in Columbus, Ohio, after a ball game in 2017." })),
    });
    expect(r.status).toBe(201);
    const f = (await r.json()) as Filed;
    const page = await person(browser, { payerId: "E2EASSTDNY234", name: "Omar Haddad", ip: "203.0.113.20" });
    await page.goto(new URL(f.confirm_url).pathname);
    await page.locator('input[name="sworn"]').check();
    await page.getByRole("button", { name: "This is my claim" }).click();
    await page.waitForURL(/\/status\//);
    await expect(page.getByRole("heading", { name: "Denied", exact: true })).toBeVisible();
  });

  test("'this isn't mine' closes a filing for good", async ({ browser }) => {
    const client = await mcp();
    const f = (await client.callTool({ name: "file_claim", arguments: filing({ tier: "no_proof", receipt: undefined, name: "Not Me", address_line: "3 Elm St", declaration: "Someone else's words about a lemonade in Albany in 2016, filed without asking me." }) })).structuredContent as Filed;
    const page = await (await browser.newContext()).newPage();
    await page.goto(new URL(f.confirm_url).pathname);
    await page.getByRole("button", { name: "This isn't mine: close it" }).click();
    await page.waitForURL(/\/confirm\/closed/);
    await expect(page.getByRole("heading", { name: "Closed" })).toBeVisible();
    const status = await client.callTool({ name: "claim_status", arguments: { status_token: f.status_token } });
    expect(status.structuredContent).toMatchObject({ state: "LAPSED", title: "Closed: never confirmed" });
    await page.goto(new URL(f.confirm_url).pathname);
    await expect(page.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();
    await client.close();
  });

  test("the confirm page passes axe on a phone, logged out and logged in, in English and Hindi (C11)", async ({ browser }) => {
    test.setTimeout(90_000);
    const client = await mcp();
    const f = (await client.callTool({ name: "file_claim", arguments: filing({ name: "Axe Person", address_line: "5 Pine St" }) })).structuredContent as Filed;
    await client.close();
    const path = new URL(f.confirm_url).pathname;
    const out = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const inn = await person(browser, { payerId: "E2EASSTAXE234", name: "Axe Person", ip: "203.0.113.30", viewport: { width: 390, height: 844 } });
    for (const [page, who] of [[out, "logged out"], [inn, "logged in"]] as const) {
      for (const lang of ["en", "hi"]) {
        await page.goto(`${path}?lang=${lang}`);
        await expectAccessible(page, `confirm page (${who}, ${lang})`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      }
    }
  });
});
