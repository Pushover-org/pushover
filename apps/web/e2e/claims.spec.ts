// Spec R10's check: a happy path, one deny and one review, through the real app on its own
// database, plus the admin login and two-person money. The claimant's Log in with PayPal is a
// cookie signed with the e2e session secret: PayPal's authorize page answers invalid_redirect_uri
// for our localhost callback (docs/sandbox-findings.md, 2026-11-10), so the live login is proved
// on the deployed app instead.
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E } from "./env.ts";

process.env["SESSION_SECRET"] = E2E.sessionSecret;
const { IDENTITY_COOKIE, sealIdentity } = await import("../lib/server/paypal-login.ts");

const S = E2E.settlement;
const PHOTO = readFileSync(new URL("./fixtures/unreadable-photo.jpg", import.meta.url));

/** A claimant who has logged in with PayPal, on their own network. */
async function claimant(browser: Browser, who: { payerId: string; name: string; state: string; ip: string }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": who.ip } });
  const value = sealIdentity({
    payerId: who.payerId, name: who.name, email: `${who.payerId.toLowerCase()}@personal.example.com`, verified: true, emailVerified: true,
    address: { line: "2211 N First St", city: "San Jose", state: who.state, zip: "95131", country: "US" },
  });
  await ctx.addCookies([{ name: IDENTITY_COOKIE, value, url: E2E.baseURL, httpOnly: true }]);
  return { ctx, page: await ctx.newPage() };
}

async function fileClaim(page: Page, f: { receipt?: boolean; state?: string; declaration: string }): Promise<string> {
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
  await page.waitForURL(new RegExp(`/claim/${S}/r/`));
  return page.url().split("/").pop() ?? "";
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
  let approvedId = "";
  let reviewId = "";
  let deniedClaimant: Page;

  test("anonymous visitors are sent to the analyst login from every admin page", async ({ page }) => {
    for (const path of [`/admin/${S}`, `/admin/${S}/money`, `/admin/${S}/claim/anything`]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      await expect(page.getByRole("heading", { name: "Analyst login" })).toBeVisible();
    }
  });

  test("happy path: a claim without a receipt is approved for the flat amount", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EAPPRVD2345", name: "Dana Reyes", state: "CA", ip: "198.51.100.10" });
    approvedId = await fileClaim(page, { declaration: "I had an iced tea with lunch at a diner on Main Street in San Jose in spring 2017." });
    await expect(page.getByRole("heading", { name: "You're approved for $10.00." })).toBeVisible();
    await expect(page.getByText("Approved at the no-proof tier")).toBeVisible();
  });

  test("deny: a claimant outside the class states is denied, with the rule's reason", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EDENYD23456", name: "Ohio Person", state: "OH", ip: "198.51.100.20" });
    deniedClaimant = page;
    await fileClaim(page, { declaration: "I bought a lemonade at a cafe near the lake in Cleveland in the summer of 2016." });
    await expect(page.getByRole("heading", { name: "Your claim was denied." })).toBeVisible();
    await expect(page.getByText("Denied: the claimant or the store is outside the class geography.")).toBeVisible();
  });

  test("a claimant can't open someone else's result", async () => {
    const res = await deniedClaimant.goto(`/claim/${S}/r/${approvedId}`);
    expect(res?.status()).toBe(404);
  });

  test("review: a receipt nobody has read goes to a person, who approves it", async ({ browser }) => {
    const { page } = await claimant(browser, { payerId: "E2EREVW234567", name: "Riley Chen", state: "NY", ip: "198.51.100.30" });
    reviewId = await fileClaim(page, { receipt: true, state: "NY", declaration: "Two coffees with breakfast at a diner on Broadway in Albany, March 2018. Receipt attached." });
    await expect(page.getByRole("heading", { name: "A person will check your claim." })).toBeVisible();
    await expect(page.getByText("Held for review: the evidence has not been read yet.")).toBeVisible();

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
    await expect(sol.locator(".ag-row").filter({ hasText: approvedId })).toContainText("SUCCESS");
  });
});
