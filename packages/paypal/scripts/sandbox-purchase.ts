// BUYER_EMAIL=… BUYER_PASSWORD=… PLAYWRIGHT_BROWSERS_PATH=… \
//   node --env-file-if-exists=.env.local packages/paypal/scripts/sandbox-purchase.ts [guarded|baseline]
// Research for plan item C5 (purchase proof from the merchant's own PayPal records). A sandbox
// buyer pays a merchant with their PayPal account, so the merchant's Transaction Search has a
// purchase to show. The order is created and captured through PayPal's Server SDK
// (OrdersController: APIMatic's create-and-capture example), and approved in a headless browser
// logged in as the buyer. Prints whether the capture's payer ID is the one Log in with PayPal gave
// for this buyer (.data/identity/payer-id.txt, from scripts/identity/try-login.ts), and saves the
// order to .data/purchases/ so probe-purchases.ts can look for it once the history catches up
// (up to three hours). Play money. The password is read from the environment and never printed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CheckoutPaymentIntent, OrdersController, PaypalExperienceUserAction, PaypalWalletContextShippingPreference } from "@paypal/paypal-server-sdk";
import type { Client, OrderRequest } from "@paypal/paypal-server-sdk";
import { chromium } from "@playwright/test";
import { limiterFromEnv, paypalClientFromEnv, type PayPalApp } from "../src/env.ts";

const app = (process.argv[2] ?? "baseline") as PayPalApp;
const email = process.env["BUYER_EMAIL"];
const password = process.env["BUYER_PASSWORD"];
if (!email || !password) throw new Error("set BUYER_EMAIL and BUYER_PASSWORD (a sandbox personal account)");
const shots = process.env["SHOTS_DIR"];
const RETURN = "https://example.com/proofofclaim/order-approved";
const CANCEL = "https://example.com/proofofclaim/order-cancelled";
const mask = (s: string | undefined) => (s ? `${s.slice(0, 3)}…${s.slice(-2)}` : "none");

const pp = paypalClientFromEnv(app, limiterFromEnv(), { maxAttempts: 1 });
const orders = (c: Client) => new OrdersController(c);
const stamp = Date.now();

const body: OrderRequest = {
  intent: CheckoutPaymentIntent.Capture,
  purchaseUnits: [{
    referenceId: `poc-c5-${stamp}`,
    description: "Sandbox purchase for purchase-proof research (play money)",
    amount: { currencyCode: "USD", value: "4.50", breakdown: { itemTotal: { currencyCode: "USD", value: "4.50" } } },
    items: [{ name: "Lemonade, 16 oz", sku: "DRINK-LEMONADE-16", quantity: "1", unitAmount: { currencyCode: "USD", value: "4.50" } }],
  }],
  paymentSource: {
    paypal: {
      experienceContext: {
        brandName: "Sandbox Cafe (demo)", returnUrl: RETURN, cancelUrl: CANCEL,
        userAction: PaypalExperienceUserAction.PayNow, shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
      },
    },
  },
};

const created = await pp.sdk.call("/v2/checkout/orders", (c) => orders(c).createOrder({ body, paypalRequestId: `poc-c5-create-${stamp}`, prefer: "return=representation" }));
const approve = created.links?.find((l) => l.rel === "payer-action")?.href;
console.log("created", created.id, created.status, "approve link:", approve ? "yes" : "no");
if (!created.id || !approve) throw new Error("no order id or payer-action link");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("https://example.com/**", (r) => r.fulfill({ status: 200, body: "ok" }));
  const shot = async (name: string) => { if (shots) await page.screenshot({ path: `${shots}/${stamp}-${name}.png`, fullPage: true }); };
  await page.goto(approve);
  await page.locator("#email").fill(email);
  if (await page.locator("#btnNext").isVisible().catch(() => false)) await page.locator("#btnNext").click();
  await page.locator("#password").fill(password);
  await shot("1-login");
  await page.locator("#btnLogin").click();
  const accept = page.locator("#acceptAllButton");
  await accept.waitFor({ timeout: 8_000 }).then(() => accept.click()).catch(() => undefined);
  // The review page's button has no stable id; its name is "Complete Purchase" (PAY_NOW) on the sandbox.
  const pay = page.getByRole("button", { name: /^(Complete Purchase|Pay Now)$/ });
  await pay.waitFor({ timeout: 60_000 });
  await shot("2-review");
  await pay.click();
  await page.waitForURL((u) => u.href.startsWith(RETURN), { timeout: 60_000 });
  console.log("approved: returned to", new URL(page.url()).pathname);
} catch (err) {
  console.log("browser step failed:", (err as Error).message.split("\n")[0]);
  const page = browser.contexts()[0]?.pages()[0];
  if (page && shots) {
    await page.screenshot({ path: `${shots}/${stamp}-failed.png`, fullPage: true }).catch(() => undefined);
    console.log("failed at", new URL(page.url()).pathname, "buttons:", JSON.stringify(await page.locator("button").allInnerTexts().catch(() => [])));
  }
  throw err;
} finally {
  await browser.close();
}

const orderId = created.id;
const captured = await pp.sdk.call(`/v2/checkout/orders/${orderId}/capture`, (c) =>
  orders(c).captureOrder({ id: orderId, paypalRequestId: `poc-c5-capture-${stamp}`, prefer: "return=representation" }),
);
const capture = captured.purchaseUnits?.[0]?.payments?.captures?.[0];
const payerId = captured.payer?.payerId;
let loginPayerId: string | undefined;
try {
  loginPayerId = readFileSync(".data/identity/payer-id.txt", "utf8").trim();
} catch {
  loginPayerId = undefined;
}
console.log("captured", JSON.stringify({
  order: captured.id, status: captured.status, capture: capture?.id, captureStatus: capture?.status, amount: capture?.amount?.value,
  payer: mask(payerId), sameAsLogin: loginPayerId ? payerId === loginPayerId : "no login payer ID saved",
}));
mkdirSync(".data/purchases", { recursive: true });
writeFileSync(`.data/purchases/${stamp}.json`, JSON.stringify({ app, order: captured.id, capture: capture?.id, at: new Date(stamp).toISOString(), payerId, buyer: email }, null, 2));
