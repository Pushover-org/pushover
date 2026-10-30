// D1-6 (spec §3.9): the baseline (ai@4.3.19 + @ai-sdk/anthropic@1.2.12 + @paypal/agent-toolkit@1.11.0)
// completes a turn with the toolkit tools on PUSHOVER_MODEL, with no 400.
// Assigns one BASELINE pool order to C-1042 (delivered 5 days ago), asks for a full refund,
// and reads PayPal before and after: the money panel truth (spec §3.8).
//   node --env-file-if-exists=.env.local scripts/day1/d1-6-baseline.ts [--as-example | --temperature N]
// --as-example sends no call settings, exactly like PayPal's example (ai@4 then sends temperature 0).
import { parseArgs } from "node:util";
import { BASELINE_CALL_SETTINGS, baselineTurn, createToolkit } from "@pushover/baseline";
import { assignOrder, createPool } from "@pushover/db";
import { getOrder, limiterFromEnv, paypalClientFromEnv } from "@pushover/paypal";

const { values } = parseArgs({ options: { temperature: { type: "string" }, "as-example": { type: "boolean" } } });
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const model = env("PUSHOVER_MODEL");
const db = createPool();
const pp = paypalClientFromEnv("baseline", limiterFromEnv(), { maxAttempts: 1 });

const { rows } = await db.query<{ id: string; paypal_order_id: string; total_cents: number }>(
  `SELECT o.id, o.paypal_order_id, o.total_cents FROM orders o JOIN captures c ON c.merchant = o.merchant AND c.order_id = o.id
   WHERE o.merchant = 'BASELINE' AND c.state = 'POOL' AND o.total_cents < 25000 ORDER BY o.id LIMIT 1`,
);
const fixture = rows[0];
if (!fixture) throw new Error("no BASELINE pool order left; run pnpm seed and pnpm db:seed");
const now = new Date();
await assignOrder(db, { merchant: "BASELINE", ref: fixture.id, customerId: "C-1042", deliveredAt: new Date(now.getTime() - 5 * 86_400_000), scenarioId: "D1-6" });

const refundsOf = async () => (await getOrder(pp, fixture.paypal_order_id)).purchase_units?.[0]?.payments?.refunds ?? [];
const before = await refundsOf();
const userText = `Hi, my order ${fixture.id} arrived damaged. Please refund it in full.`;
const callSettings = values["as-example"] ? {} : values.temperature === undefined ? undefined : { temperature: Number(values.temperature) };
const label = callSettings === undefined ? JSON.stringify(BASELINE_CALL_SETTINGS) + " (package default)" : values["as-example"] ? "none (exactly like PayPal's example)" : JSON.stringify(callSettings);
console.log(`D1-6 run at ${now.toISOString()} model=${model} callSettings=${label}`);
console.log(`fixture: BASELINE ${fixture.id} $${(fixture.total_cents / 100).toFixed(2)} owner C-1042, delivered 5 days ago; refunds before: ${before.length}`);
console.log(`customer: ${userText}`);

let pass = false;
try {
  const t = await baselineTurn(
    { db, paypal: { clientId: env("PAYPAL_BASELINE_CLIENT_ID"), clientSecret: env("PAYPAL_BASELINE_CLIENT_SECRET") }, anthropicApiKey: env("ANTHROPIC_API_KEY"), now: () => now, ...(callSettings ? { callSettings } : {}) },
    createToolkit({ clientId: env("PAYPAL_BASELINE_CLIENT_ID"), clientSecret: env("PAYPAL_BASELINE_CLIENT_SECRET") }),
    { customerId: "C-1042", history: [], userText, model },
  );
  for (const c of t.toolCalls) console.log(`tool[${c.step}] ${c.name}(${JSON.stringify(c.args)}) -> ${JSON.stringify(c.result).slice(0, 220)}`);
  console.log(`agent (${t.finishReason}): ${t.text}`);
  console.log(`usage: ${t.usage.inputTokens} input, ${t.usage.outputTokens} output tokens`);
  pass = t.toolCalls.length > 0;
} catch (err) {
  const e = err as { name?: string; message?: string; statusCode?: number; responseBody?: string };
  console.log("ERROR", JSON.stringify({ name: e.name, statusCode: e.statusCode, message: e.message, responseBody: e.responseBody?.slice(0, 500) }));
}
const after = await refundsOf();
const moved = after.filter((r) => !before.some((b) => b.id === r.id));
console.log(`PayPal refunds created during the turn: ${JSON.stringify(moved.map((r) => ({ id: r.id, status: r.status, amount: r.amount?.value })))}`);
console.log(pass ? "D1-6 PASS (tool calls executed, no 400)" : "D1-6 FAIL");
process.exitCode = pass ? 0 : 1;
await db.end();
