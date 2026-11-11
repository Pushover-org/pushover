// node --env-file-if-exists=.env.local packages/paypal/scripts/probe-purchases.ts [guarded|baseline] [days]
// Research for plan item C5 (purchase proof from the merchant's own PayPal records), by asking the
// sandbox rather than assuming: which purchases show in a merchant's Transaction Search with
// fields=all, and whether each carries the payer's PayPal account ID (payer_info.account_id) and
// the items bought (cart_info.item_details). Reads only, through PayPal's Server SDK.
// Prints a summary per transaction; payer IDs are shortened.
import { TransactionSearchController } from "@paypal/paypal-server-sdk";
import { limiterFromEnv, paypalClientFromEnv, type PayPalApp } from "../src/env.ts";

const app = (process.argv[2] ?? "guarded") as PayPalApp;
const days = Math.min(31, Number(process.argv[3] ?? "31"));
const pp = paypalClientFromEnv(app, limiterFromEnv());
const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const end = new Date();
const start = new Date(end.getTime() - days * 86_400_000);
const short = (id: string | undefined) => (id ? `${id.slice(0, 4)}…(${id.length})` : "none");

const byCode = new Map<string, number>();
let page = 1;
for (;;) {
  const res = await pp.sdk.call("/v1/reporting/transactions", (c) =>
    new TransactionSearchController(c).searchTransactions({ startDate: fmt(start), endDate: fmt(end), fields: "all", pageSize: 100, page }),
  );
  if (page === 1) console.log(app, "window", fmt(start), "→", fmt(end), "total_items", res.totalItems, "pages", res.totalPages, "last_refreshed", res.lastRefreshedDatetime);
  for (const d of res.transactionDetails ?? []) {
    const t = d.transactionInfo;
    const code = t?.transactionEventCode ?? "?";
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
    if (code.startsWith("T0001")) continue; // payouts we sent: not purchases
    console.log(JSON.stringify({
      code, status: t?.transactionStatus, at: t?.transactionInitiationDate, amount: t?.transactionAmount?.value, instrument: t?.instrumentType, method: t?.paymentMethodType,
      payer: short(d.payerInfo?.accountId), payerStatus: d.payerInfo?.payerStatus, payerEmail: d.payerInfo?.emailAddress ? "yes" : "no", counterparty: short(t?.paypalAccountId),
      items: d.cartInfo?.itemDetails?.map((i) => ({ code: i.itemCode, name: i.itemName, qty: i.itemQuantity })) ?? [],
    }));
  }
  if (!res.totalPages || page >= res.totalPages) break;
  page++;
}
console.log("event codes", JSON.stringify(Object.fromEntries(byCode)));
