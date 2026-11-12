import { webhookCounts } from "@proofofclaim/db";
import type { Metadata } from "next";
import { dollars } from "@/lib/labels.ts";
import { DEMO_SETTLEMENT, pool, settlement } from "@/lib/server/data.ts";
import { DEMO_DAILY_CAP_CENTS, money } from "@/lib/server/money.ts";
import s from "./judge.module.css";

export const metadata: Metadata = { title: "Judges: start here" };
export const dynamic = "force-dynamic";

const S = DEMO_SETTLEMENT;

interface Check {
  name: string;
  on: boolean;
  detail: string;
}

/** What is switched on in this deployment, read from its configuration and database at page load. */
async function status(): Promise<{ checks: Check[]; claims: number }> {
  const env = (k: string) => process.env[k] ?? "";
  const api = env("PAYPAL_API_BASE");
  const sandbox = /^https:\/\/api-m\.sandbox\.paypal\.com\/?$/.test(api);
  const returnUrl = env("PAYPAL_LOGIN_RETURN_URL") || (env("PUBLIC_ORIGIN") ? `${env("PUBLIC_ORIGIN")}/api/paypal/callback` : "");
  const sett = await settlement(S);
  const [hooks, m, counts] = await Promise.all([
    webhookCounts(pool()).catch(() => null),
    sett ? money(S, sett.fundCents).catch(() => null) : Promise.resolve(null),
    pool().query<{ claims: number }>("SELECT count(*)::int AS claims FROM claims WHERE settlement_id = $1 AND status NOT IN ('UNBOUND', 'LAPSED')", [S]).catch(() => null),
  ]);
  const budget = Number(env("DEMO_AI_BUDGET_USD") || "1");
  return {
    claims: counts?.rows[0]?.claims ?? 0,
    checks: [
      { name: "PayPal, sandbox only", on: sandbox, detail: sandbox ? "Every call goes to api-m.sandbox.paypal.com; the client refuses any other address. Play money." : "Not the sandbox: money screens are off." },
      { name: "Log in with PayPal", on: Boolean(returnUrl && env("PAYPAL_GUARDED_CLIENT_ID")), detail: returnUrl ? "Each claim is tied to one verified PayPal account." : "No return address configured." },
      {
        name: "AI examiner",
        on: Boolean(env("ANTHROPIC_API_KEY")),
        detail: env("ANTHROPIC_API_KEY") ? `${env("PUSHOVER_MODEL") || "claude-haiku-5-5"} reads each receipt; at most $${budget.toFixed(2)} of API spend per server start. It never decides.` : "Off: receipts go to a person unread.",
      },
      {
        name: "PayPal payouts webhook",
        on: Boolean(env("PAYPAL_GUARDED_WEBHOOK_ID")),
        detail: env("PAYPAL_GUARDED_WEBHOOK_ID") ? `Every delivery is verified with PayPal before it is stored; ${hooks?.verified ?? 0} verified so far.` : "Not registered.",
      },
      {
        name: "Sandbox money limit",
        on: true,
        detail: `${dollars(DEMO_DAILY_CAP_CENTS, 0)} of play money per 24 hours for the public demo; ${dollars(m?.sentLast24hCents ?? 0)} sent in the last 24 hours.`,
      },
      { name: "AG Grid Studio (Ask the desk)", on: Boolean(env("AG_STUDIO_LICENSE_KEY")), detail: env("AG_STUDIO_LICENSE_KEY") ? "Trial licence." : "No licence key: Community grid only." },
      { name: "Bryntum timeline (linked groups)", on: Boolean(env("BRYNTUM_LICENSE_KEY")), detail: env("BRYNTUM_LICENSE_KEY") ? "Trial licence." : "No licence key: runs with Bryntum's trial badge." },
    ],
  };
}

interface LastPayout {
  claim_id: string;
  amount_cents: number;
  fee_cents: number | null;
  outcome: string;
  paypal_status: string | null;
  paypal_item_id: string | null;
  paypal_batch_id: string | null;
  history_status: string;
  history_code: string | null;
  sent_at: Date;
}

/** The newest real sandbox payout on this deployment, from the records PayPal's answers were written to (plan item P49). */
async function lastPayout(): Promise<LastPayout | null> {
  const { rows } = await pool()
    .query<LastPayout>(
      `SELECT i.claim_id, i.amount_cents, i.fee_cents, i.outcome, i.paypal_status, i.paypal_item_id, b.paypal_batch_id, i.history_status, i.history_code, b.created_at AS sent_at
       FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id
       WHERE b.settlement_id = $1 AND b.kind = 'CLAIMS' AND i.paypal_item_id IS NOT NULL
       ORDER BY (i.history_status = 'CONFIRMED') DESC, (i.paypal_status = 'SUCCESS') DESC, b.id DESC, i.id LIMIT 1`,
      [S],
    )
    .catch(() => ({ rows: [] as LastPayout[] }));
  return rows[0] ?? null;
}

const HISTORY: Record<string, string> = {
  NOT_CHECKED: "not looked up yet",
  WAITING: "not in PayPal's history yet (it can take hours in the sandbox)",
  CONFIRMED: "found in PayPal's own transaction history",
  NEVER_CAUGHT_UP: "still missing from PayPal's history after three days",
};

export default async function Judge() {
  const [{ checks, claims }, paid] = await Promise.all([status(), lastPayout()]);
  const analystPw = process.env["JUDGE_ANALYST_PASSWORD"] ?? "";
  const supervisorPw = process.env["JUDGE_SUPERVISOR_PASSWORD"] ?? "";
  const buyerEmail = process.env["JUDGE_BUYER_EMAIL"] ?? "";
  const buyerPw = process.env["JUDGE_BUYER_PASSWORD"] ?? "";

  return (
    <div className={s.page}>
      <header className={s.head}>
        <p className="label">Judges · about four minutes · no sign-up</p>
        <h1 className="display">Judges, start here.</h1>
        <p className={s.lede}>
          Proof of Claim is a claims desk for class-action settlements. An AI reads each claim&apos;s receipt; plain rules decide; a person approves the
          money; PayPal pays it; unclaimed money goes to the court&apos;s chosen nonprofit. The settlement here is fictional, with {claims} claims
          on file, and all money is PayPal sandbox play money.
        </p>
      </header>

      <section aria-labelledby="logins" className={s.card}>
        <h2 id="logins">Sandbox logins</h2>
        <dl className={s.logins}>
          <div>
            <dt>Claimant (on PayPal&apos;s sandbox login page)</dt>
            <dd>
              <code>{buyerEmail || "not set"}</code> <code>{buyerPw || "not set"}</code>
            </dd>
          </div>
          <div>
            <dt>Claims analyst (proposes payments)</dt>
            <dd>
              <code>analyst@judges.example</code> <code>{analystPw || "not set"}</code>
            </dd>
          </div>
          <div>
            <dt>Supervisor (approves them; a different person)</dt>
            <dd>
              <code>supervisor@judges.example</code> <code>{supervisorPw || "not set"}</code>
            </dd>
          </div>
        </dl>
        <p className={s.note}>The claimant login works only on PayPal&apos;s sandbox, never on paypal.com. Nothing here moves real money.</p>
        <p className={s.note}>
          Everyone shares this one demo: what you approve or send, the next visitor sees. On 12 November the two linked groups were decided and a first payment round
          was sent, so the payout trail below is real.
        </p>
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps" className={s.h2}>
          The tour
        </h2>
        <ol className={s.steps}>
          <li>
            <h3>See every decision</h3>
            <p>
              The <a href="/demo">live demo</a> shows the {claims} claims, each decided by the same code that decides a new one: fraud stopped, honest
              claims paid, and where the model said &ldquo;approve&rdquo; and the rule said no.
            </p>
          </li>
          <li>
            <h3>File a claim yourself</h3>
            <p>
              <a href={`/claim/${S}`}>File a claim</a>: Log in with PayPal using the claimant login above, then pick &ldquo;No receipt&rdquo; ($10
              flat) or photograph any restaurant receipt. The AI reports what the receipt shows; the rules decide on the spot and say why.
            </p>
          </li>
          <li>
            <h3>Open the claims desk</h3>
            <p>
              <a href="/login">Log in as the analyst</a>. The <a href={`/admin/${S}`}>claims desk</a> lists every claim; filter &ldquo;Model said ≠
              rules said&rdquo; to see the AI overruled, and open one to read each check and its reason. Unknown is never shown as safe: it waits for a
              person.
            </p>
          </li>
          <li>
            <h3>Look at the linked groups</h3>
            <p>
              <a href={`/admin/${S}/groups`}>Linked groups</a> are claims that share an inbox, a device or a story. The investigator writes what it sees
              and how sure it is; a person clears or holds the group.
            </p>
          </li>
          <li>
            <h3>Move the money, with two people</h3>
            <p>
              On <a href={`/admin/${S}/money`}>Money</a> the analyst proposes a payment round. Log out, log in as the supervisor and approve it: PayPal
              Payouts sends it in the sandbox, the page reads PayPal&apos;s answer back, and the worker later finds each payout in PayPal&apos;s own
              history. Unclaimed money waits out its re-offer window, then goes to the nonprofit in a second batch. For a round with 120,000
              claimants, see the <a href="/demo/scale">simulated scale page</a> (clearly marked; never sent to PayPal).
            </p>
          </li>
          <li>
            <h3>Check the public record</h3>
            <p>
              The <a href={`/report/${S}`}>court report</a> totals every dollar. The <a href={`/report/${S}/ledger`}>public ledger</a> lets anyone check,
              in the browser, that a claim&apos;s decision is in the committed record.
            </p>
          </li>
          <li>
            <h3>Ask the desk</h3>
            <p>
              <a href={`/admin/${S}/ask`}>Ask the desk</a> (AG Grid Studio) answers questions about the claims in a grid; it reads, it never decides.
            </p>
          </li>
          <li>
            <h3>Let an assistant file</h3>
            <p>
              AI assistants file through the MCP server at <code>/api/mcp</code> or the JSON API (<a href="/api/openapi.json">OpenAPI</a>). A claim an
              assistant files waits until its person confirms it with Log in with PayPal.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="payout" className={s.card}>
        <h2 id="payout">A real sandbox payout, end to end</h2>
        {paid ? (
          <ol className={s.trail}>
            <li>
              Claim <a href={`/admin/${S}/claim/${paid.claim_id}`}>{paid.claim_id}</a> was approved by the rules for {dollars(paid.amount_cents)}.
            </li>
            <li>An analyst proposed the round and a different supervisor approved it; only then was PayPal called.</li>
            <li>
              PayPal Payouts batch <code>{paid.paypal_batch_id ?? "pending"}</code>, item <code>{paid.paypal_item_id}</code>: PayPal reports{" "}
              <b>{paid.paypal_status ?? "no status yet"}</b>
              {paid.fee_cents != null ? `, fee ${dollars(paid.fee_cents)}` : ""} (sent {paid.sent_at.toISOString().slice(0, 16).replace("T", " ")} UTC).
            </li>
            <li>
              PayPal&apos;s history: {HISTORY[paid.history_status] ?? paid.history_status}
              {paid.history_code ? ` (event code ${paid.history_code})` : ""}.
            </li>
            <li>
              The payment is in the <a href={`/report/${S}`}>court report</a> and its decision in the <a href={`/report/${S}/ledger`}>public ledger</a>.
            </li>
          </ol>
        ) : (
          <p className={s.note}>No payout has been sent on this deployment yet. Step 5 of the tour sends one.</p>
        )}
      </section>

      <section aria-labelledby="status" className={s.card}>
        <h2 id="status">What is on right now</h2>
        <p className={s.note}>Read from this server&apos;s configuration and database when the page loaded. We only claim what is on.</p>
        <ul className={s.status}>
          {checks.map((c) => (
            <li key={c.name}>
              <span className={s.state} data-on={c.on}>
                {c.on ? "On" : "Off"}
              </span>
              <span>
                <b>{c.name}</b> {c.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
