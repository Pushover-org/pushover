// Spec R10's check: a happy path, one deny and one review, through the real app on its own
// database, plus the admin login and two-person money. The claimant's Log in with PayPal is a
// cookie signed with the e2e session secret: PayPal's authorize page answers invalid_redirect_uri
// for our localhost callback (docs/sandbox-findings.md, 2026-11-10), so the live login is proved
// on the deployed app instead.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E } from "./env.ts";

process.env["SESSION_SECRET"] = E2E.sessionSecret;
const { IDENTITY_COOKIE, sealIdentity } = await import("../lib/server/paypal-login.ts");

const S = E2E.settlement;
const PHOTO = readFileSync(new URL("./fixtures/unreadable-photo.jpg", import.meta.url));

const streetOf = (payerId: string) => `${payerId.charCodeAt(3)}${payerId.charCodeAt(6)} Oak Ave`;

/** A claimant who has logged in with PayPal, on their own network. */
async function claimant(browser: Browser, who: { payerId: string; name: string; state: string; ip: string; verified?: boolean }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": who.ip } });
  const value = sealIdentity({
    payerId: who.payerId, name: who.name, email: `${who.payerId.toLowerCase()}@personal.example.com`, verified: who.verified ?? true, emailVerified: true,
    // Each claimant has their own home: C8 rightly denies a second claim from the same address.
    address: { line: streetOf(who.payerId), city: "San Jose", state: who.state, zip: "95131", country: "US" },
  });
  await ctx.addCookies([{ name: IDENTITY_COOKIE, value, url: E2E.baseURL, httpOnly: true }]);
  return { ctx, page: await ctx.newPage() };
}

/** Files a claim through the form; returns the claim ID and the private status link's path. */
async function fileClaim(page: Page, f: { receipt?: boolean; state?: string; declaration: string }): Promise<{ id: string; link: string }> {
  await page.goto(`/claim/${S}`);
  await expect(page.getByText(/^Signed in as/)).toBeVisible();
  if (f.receipt) {
    await page.locator('input[name="receipt"]').setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: PHOTO });
  } else {
    await page.getByRole("button", { name: /No receipt/ }).click();
  }
  if (f.state) await page.locator('select[name="state"]').selectOption(f.state);
  await page.locator('textarea[name="declaration"]').fill(f.declaration);
  await page.locator('input[name="sworn"]').check();
  await page.getByRole("button", { name: "File my claim" }).click();
  await page.waitForURL(/\/status\/[A-Za-z0-9_-]{32}$/);
  const label = (await page.locator("p.label").first().textContent()) ?? "";
  return { id: /claim\s+(\S+)/.exec(label)?.[1] ?? "", link: new URL(page.url()).pathname };
}

/** The status page is private but carries nothing personal. */
async function expectNothingPersonal(page: Page, name: string, payerId: string) {
  const text = (await page.locator("main").textContent()) ?? "";
  expect(text).not.toContain(name);
  expect(text).not.toContain(payerId);
  expect(text.toLowerCase()).not.toContain("@personal.example.com");
  expect(text).not.toContain(streetOf(payerId));
}

async function analyst(browser: Browser, who: { email: string; password: string }, next: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(next);
  await page.waitForURL(/\/login\?next=/);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${E2E.baseURL}${next}`);
  return page;
}

test.describe.serial("a claim, from filing to payment", () => {
  let approved = { id: "", link: "" };
  let approvedPage: Page;
  let deniedClaimant: Page;

  test("anonymous visitors are sent to the analyst login from every admin page", async ({ page }) => {
    for (const path of [`/admin/${S}`, `/admin/${S}/money`, `/admin/${S}/claim/anything`, `/admin/${S}/groups`, `/admin/${S}/groups/timeline`, `/admin/${S}/scoreboard`, `/admin/${S}/ask`, "/admin/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      await expect(page.getByRole("heading", { name: "Analyst login" })).toBeVisible();
    }
  });

  test("the desk agent's model route refuses anyone not logged in as an analyst (C13)", async ({ page }) => {
    const anon = await page.request.post("/api/admin/studio-ai", { data: { input: [] } });
    expect(anon.status()).toBe(401);
    expect(await anon.json()).toMatchObject({ status: "failed", error: { code: "unauthorised" } });
  });

  test("happy path: a claim without a receipt is approved for the flat amount", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EAPPRVD2345", name: "Dana Reyes", state: "CA", ip: "198.51.100.10" });
    approvedPage = page;
    approved = await fileClaim(page, { declaration: "I had an iced tea with lunch at a diner on Main Street in San Jose in spring 2017." });
    await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
    await expect(page.getByText("Approved at the no-receipt tier")).toBeVisible();
    await expect(page.locator("b.num", { hasText: "$10.00" })).toBeVisible();
    await expectNothingPersonal(page, "Dana Reyes", "E2EAPPRVD2345");
  });

  test("deny: a claimant outside the class states is denied, with the rule's reason", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EDENYD23456", name: "Ohio Person", state: "OH", ip: "198.51.100.20" });
    deniedClaimant = page;
    await fileClaim(page, { declaration: "I bought a lemonade at a cafe near the lake in Cleveland in the summer of 2016." });
    await expect(page.getByRole("heading", { name: "Denied", exact: true })).toBeVisible();
    await expect(page.getByText("Denied: you or the store are outside the class states.")).toBeVisible();
  });

  test("a denied claimant reads why in plain words and appeals; a person sees the appeal and decides (C3, P9, C9)", async ({ browser }) => {
    test.setTimeout(90_000);
    const page = deniedClaimant;
    const deniedId = /claim\s+(\S+)/.exec((await page.locator("p.label").first().textContent()) ?? "")?.[1] ?? "";
    await expect(page.getByText(/This settlement covers .*\. Your address is in Ohio\./)).toBeVisible();
    await page.getByLabel("What should they know?").fill("I lived in San Jose until 2017 and bought the lemonade there; I moved to Ohio later.");
    await page.getByRole("button", { name: "Send my appeal" }).click();
    await page.waitForURL(/sent=appeal/);
    await expect(page.getByText("Your appeal is with a person. You'll see the decision here.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Held for a person", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send my appeal" })).toHaveCount(0);

    const desk = await analyst(browser, E2E.analyst, `/admin/${S}/claim/${deniedId}`);
    await expect(desk.getByRole("region", { name: "From the claimant" })).toContainText("I lived in San Jose until 2017");
    await expect(desk.getByText("waiting for a person")).toBeVisible();
    await desk.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(desk.getByText("answered")).toBeVisible();
    await page.goto(new URL(page.url()).pathname);
    await expect(page.getByText("Denied by a claims analyst after review.")).toBeVisible();
  });

  test("the claim and status pages in Hindi and Spanish, with the reason in plain words (C12, C3)", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2ESPANSH2345", name: "Sofia Ramos", state: "OH", ip: "198.51.100.60" });
    await page.goto(`/claim/${S}?lang=hi`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("हिस्सा पाएँ।");
    await expect(page.locator('div[lang="hi"]').first()).toBeVisible();
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reclame su");
    await page.getByRole("button", { name: /Sin recibo/ }).click();
    await page.locator('textarea[name="declaration"]').fill("Tomé una limonada en un restaurante de Cleveland en el verano de 2016, con mi familia.");
    await page.locator('input[name="sworn"]').check();
    await page.getByRole("button", { name: "Presentar mi reclamo" }).click();
    await page.waitForURL(/\/status\/[A-Za-z0-9_-]{32}$/);
    await expect(page.getByRole("heading", { name: "Denegado", exact: true })).toBeVisible();
    await expect(page.getByText(/Este acuerdo cubre .*\. Su dirección está en Ohio\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar mi apelación" })).toBeVisible();
  });

  test("a made-up status link shows nothing", async () => {
    const res = await deniedClaimant.goto(`/status/${"A".repeat(32)}`);
    expect(res?.status()).toBe(404);
  });

  test("one PayPal account files once: coming back gives a new private link, and the old one stops working", async () => {
    await approvedPage.goto(`/claim/${S}`);
    await expect(approvedPage.getByText("This PayPal account has already filed a claim in this settlement.")).toBeVisible();
    await expect(approvedPage.locator('textarea[name="declaration"]')).toHaveCount(0);
    await approvedPage.getByRole("button", { name: "Show my claim's status" }).click();
    await approvedPage.waitForURL(/\/status\/[A-Za-z0-9_-]{32}$/);
    expect(new URL(approvedPage.url()).pathname).not.toBe(approved.link);
    await expect(approvedPage.getByText(`claim ${approved.id}`)).toBeVisible();
    expect((await approvedPage.request.get(approved.link)).status()).toBe(404);
  });

  test("an approved claim from an unverified PayPal account waits, and says why", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EUNVRFD2345", name: "Uma Ortiz", state: "WA", ip: "198.51.100.40", verified: false });
    await page.goto(`/claim/${S}`);
    await expect(page.getByText("not verified yet: an approved claim is paid once it is")).toBeVisible();
    await fileClaim(page, { declaration: "A hot chocolate at a cafe by the ferry dock in Seattle, one rainy November in 2016." });
    await expect(page.getByRole("heading", { name: "Approved, waiting for PayPal verification" })).toBeVisible();
  });

  test("review: a receipt nobody has read goes to a person, who approves it", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EREVW234567", name: "Riley Chen", state: "NY", ip: "198.51.100.30" });
    const { id: reviewId } = await fileClaim(page, { receipt: true, state: "NY", declaration: "Two coffees with breakfast at a diner on Broadway in Albany, March 2018. Receipt attached." });
    await expect(page.getByRole("heading", { name: "Held for a person" })).toBeVisible();
    await expect(page.getByText("Held for a person: the receipt hasn't been read yet.")).toBeVisible();

    const desk = await analyst(browser, E2E.analyst, `/admin/${S}/claim/${reviewId}`);
    await expect(desk.getByText("A person decides this one.")).toBeVisible();
    await desk.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(desk.getByText("A person decides this one.")).toBeHidden();
    await expect(desk.getByText("ANALYST_APPROVED")).toBeVisible();
    await expect(desk.getByText(`analyst ${E2E.analyst.email}`)).toBeVisible();
  });

  test("money: an analyst proposes, can't approve their own, and a supervisor sends it to PayPal", async ({ browser }) => {
    test.setTimeout(120_000); // two logins (scrypt) and the re-check before planning
    const ana = await analyst(browser, E2E.analyst, `/admin/${S}/money`);
    await expect(ana.getByRole("heading", { name: /Pay 2 approved claimants/ })).toBeVisible();
    await expect(ana.getByText(/1\s*approved but held: their PayPal account isn.t verified/)).toBeVisible();
    await ana.getByRole("button", { name: /Propose paying \$25\.00/ }).click();
    await expect(ana.getByText("Waiting for a supervisor other than you to approve.")).toBeVisible();
    await expect(ana.getByRole("button", { name: /Hold to approve/ })).toHaveCount(0);

    const sol = await analyst(browser, E2E.supervisor, `/admin/${S}/money`);
    await expect(sol.getByText(/E2E Analyst proposed round 1/)).toBeVisible();
    const hold = sol.getByRole("button", { name: /Hold to approve and send \$25\.00/ });
    await hold.hover();
    await sol.mouse.down();
    await sol.waitForTimeout(1600);
    await sol.mouse.up();
    await expect(sol.getByText(/E2EBATCH1 · round 1/)).toBeVisible({ timeout: 20_000 });

    await sol.getByRole("button", { name: "Read back from PayPal" }).click();
    await expect(sol.getByText("Batch SUCCESS: 2 paid.")).toBeVisible({ timeout: 20_000 });
    await sol.reload();
    // The PayPal-logged-in claimant is paid to their account, not an email.
    await expect(sol.getByText("PayPal account (logged in)").first()).toBeVisible();
    await expect(sol.locator(".ag-row").filter({ hasText: approved.id })).toContainText("SUCCESS");
  });

  test("anyone can verify the decision ledger in their own browser", async ({ page }) => {
    // drand's relays are stubbed: the committed round is ~30 s ahead, and e2e must not need the network.
    await page.route(/drand\.(sh|cloudflare\.com)\//, (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.goto(`/report/${S}/ledger`);
    await expect(page.getByRole("heading", { name: /fixed before the money moved/ })).toBeVisible();
    await page.getByRole("button", { name: "Verify in my browser" }).first().click();
    const result = page.locator('[role="status"]').filter({ hasText: "Every decision hashes" }).first();
    await expect(result).toContainText("PASS Every decision hashes to the committed root");
    await expect(result).toContainText("PASS The commitment's digest matches");
    await expect(result).toContainText("PASS PayPal's record names this ledger: 2 of 2 payouts read back from PayPal carry this digest in their note");
    await expect(result).toContainText("PASS The drand round didn't exist when the root was fixed");
    await expect(result).not.toContainText("FAIL");
  });

  test("a ledger changed after the fact fails the check", async ({ page }) => {
    await page.route(/\/api\/ledger\//, async (r) => {
      const res = await r.fetch();
      const j = (await res.json()) as { leaves: { amountCents: number | null }[] };
      const first = j.leaves[0];
      if (first) first.amountCents = (first.amountCents ?? 0) + 100_000; // one claim quietly given $1,000 more
      await r.fulfill({ response: res, json: j });
    });
    await page.route(/drand\.(sh|cloudflare\.com)\//, (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.goto(`/report/${S}/ledger`);
    await page.getByRole("button", { name: "Verify in my browser" }).first().click();
    await expect(page.getByText("FAILED: this ledger doesn't check out.").first()).toBeVisible();
    await expect(page.locator('[role="status"]').first()).toContainText("FAIL Every decision hashes to the committed root");
  });

  test("a supervisor opens a settlement from the form, and a claimant files into it (P17, P18)", async ({ browser }) => {
    test.setTimeout(90_000);
    const sol = await analyst(browser, E2E.supervisor, "/admin/new");
    await sol.locator('input[name="id"]').fill("e2e-bottle-settlement");
    await sol.locator('input[name="name"]').fill("E2E Bottle Settlement");
    await sol.locator('input[name="fund"]').fill("5000");
    await sol.locator('input[name="reserve"]').fill("250");
    await sol.locator('input[name="periodStart"]').fill("2015-01-01");
    await sol.locator('input[name="periodEnd"]').fill("2019-12-31");
    await sol.locator('input[name="productId"]').fill("insulated-bottle");
    await sol.locator('input[name="productName"]').fill("Insulated water bottle");
    await sol.locator('input[name="productDescription"]').fill("Any insulated water bottle");
    for (const st of ["CA", "NY"]) await sol.locator(`input[name="states"][value="${st}"]`).check();
    await sol.locator('input[name="unit"]').fill("15");
    await sol.locator('input[name="maxUnits"]').fill("5");
    await sol.locator('input[name="flat"]').fill("10");
    await sol.locator('input[name="cyPresName"]').fill("Clean Water Access Fund");
    await sol.locator('input[name="cyPresEmail"]').fill("po-merchant-baseline-3h8w@business.example.com");
    await sol.getByRole("button", { name: "Open the settlement" }).click();
    await sol.waitForURL(`${E2E.baseURL}/admin/e2e-bottle-settlement`);

    const pub = await (await browser.newContext()).newPage();
    await pub.goto("/settlements");
    await expect(pub.getByRole("heading", { name: "E2E Bottle Settlement (fictional demo)" })).toBeVisible();

    const { page } = await claimant(browser, { payerId: "E2EBTTLE23456", name: "Bea Bottle", state: "CA", ip: "198.51.100.60" });
    await page.goto("/claim/e2e-bottle-settlement");
    await page.getByRole("button", { name: /No receipt/ }).click();
    await page.locator('textarea[name="declaration"]').fill("I bought two insulated bottles for hiking trips at an outdoor shop in Sacramento in 2018.");
    await page.locator('input[name="sworn"]').check();
    await page.getByRole("button", { name: "File my claim" }).click();
    await page.waitForURL(/\/status\/[A-Za-z0-9_-]{32}$/);
    await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
    await expect(page.getByText("E2E Bottle Settlement (fictional demo)")).toBeVisible();
  });

  test("live: the browser fetches the committed drand round from drand's relays and verifies it (LIVE_DRAND=1)", async ({ page }) => {
    test.skip(!process.env["LIVE_DRAND"], "needs the real drand network; run with LIVE_DRAND=1");
    test.setTimeout(120_000);
    await page.waitForTimeout(40_000); // the committed round is ~30 s after the payout
    await page.goto(`/report/${S}/ledger`);
    await page.getByRole("button", { name: "Verify in my browser" }).first().click();
    const result = page.locator('[role="status"]').filter({ hasText: "Every decision hashes" }).first();
    await expect(result).toContainText(/PASS drand's beacon, from drand's relays: round \d+ verified against quicknet's public key/, { timeout: 30_000 });
    await expect(result).toContainText("PASS The audit sample nobody could pick");
    await expect(result).toContainText("Every check passes.");
  });
});


/** No WCAG 2.x A or AA rule axe can check fails (C11). */
async function expectAccessible(page: Page, what: string) {
  // Measure the page as it settles: mid fade-in, text is still partly transparent.
  await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== "running" || x.effect?.getTiming().iterations === Infinity), null, { timeout: 5000 });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("nextjs-portal").analyze();
  expect(r.violations.map((v) => `${what}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ") ?? ""}`)).toEqual([]);
}

test.describe("accessibility (C11)", () => {
  test("the claimant's pages pass axe on a phone, with nothing wider than the screen", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.70" } });
    const value = sealIdentity({
      payerId: "E2EAXEPHN2345", name: "Ana Axe", email: "e2eaxephn2345@personal.example.com", verified: true, emailVerified: true,
      address: { line: "70 Elm St", city: "Columbus", state: "OH", zip: "43004", country: "US" },
    });
    await ctx.addCookies([{ name: IDENTITY_COOKIE, value, url: E2E.baseURL, httpOnly: true }]);
    const page = await ctx.newPage();
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const lang of ["en", "hi"]) {
      await page.goto(`/claim/${S}?lang=${lang}`);
      await expectAccessible(page, `claim page (${lang})`);
      await fits();
    }
    await page.goto(`/claim/${S}?lang=en`);
    await page.getByRole("button", { name: /No receipt/ }).click();
    await page.locator('textarea[name="declaration"]').fill("A lemonade at a diner in Columbus, summer 2016, with my brother after a game.");
    await page.locator('input[name="sworn"]').check();
    await page.getByRole("button", { name: "File my claim" }).click();
    await page.waitForURL(/\/status\/[A-Za-z0-9_-]{32}$/);
    await expect(page.getByRole("heading", { name: "Denied", exact: true })).toBeVisible();
    await expectAccessible(page, "status page with the appeal form");
    await fits();
    for (const path of ["/", `/settlements`, "/login", `/report/${S}`]) {
      await page.goto(path);
      await expectAccessible(page, path);
      await fits();
    }
  });

  test("the analyst's desk and a claim page pass axe", async ({ browser }) => {
    const desk = await analyst(browser, E2E.analyst, `/admin/${S}`);
    await expect(desk.locator(".ag-row").first()).toBeVisible();
    await expectAccessible(desk, "claims desk");
    const first = await desk.locator(".ag-row[row-id]").first().getAttribute("row-id");
    await desk.goto(`/admin/${S}/claim/${first}`);
    await expectAccessible(desk, "claim page");
  });
});
