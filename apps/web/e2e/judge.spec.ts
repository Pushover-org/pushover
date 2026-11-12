// The judges' page (plan item P46): numbered steps, the sandbox logins, and a status list read from
// the server's own configuration. The e2e server talks to a fake PayPal on localhost, so "sandbox only"
// must read Off here: the page reports what is configured, not what we hope.
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test } from "@playwright/test";

test("a first-time visitor gets the tour, the logins and an honest status list", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto("/judge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Judges, start here.");
  await expect(page.locator("ol li h3")).toHaveCount(8);
  await expect(page.getByText("analyst@judges.example")).toBeVisible();
  await expect(page.getByText("supervisor@judges.example")).toBeVisible();
  const sandbox = page.locator("ul li", { hasText: "PayPal, sandbox only" });
  await expect(sandbox).toContainText("Off");
  // Linked from the product's navigation and the landing page.
  await expect(page.getByRole("link", { name: "Judges" })).toHaveAttribute("href", "/judge");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("nextjs-portal").analyze();
  expect(r.violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ") ?? ""}`)).toEqual([]);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Judges: start here" })).toHaveAttribute("href", "/judge");
  await ctx.close();
});

test("the scale page keeps simulated and real money apart, and the simulated fund balances (P41)", async ({ page }) => {
  await page.goto("/demo/scale");
  await expect(page.getByText("Simulated · never sent to PayPal")).toBeVisible();
  await expect(page.getByText("Real sandbox · play money")).toBeVisible();
  await expect(page.getByText(/reserve equal the fund exactly/)).toBeVisible();
});
