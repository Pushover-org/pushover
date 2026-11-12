import { CHECK_IDS, CHECK_NAMES } from "@proofofclaim/claims";
import { Check } from "@/components/site/Check.tsx";
import { Nav } from "@/components/site/Nav.tsx";
import { Pile } from "@/components/site/Pile.tsx";
import { Reveal } from "@/components/site/Reveal.tsx";
import { SmoothScroll } from "@/components/site/SmoothScroll.tsx";
import { Thread } from "@/components/site/Thread.tsx";
import { GROUPS, REASON_TEXT, loadPilot, type Interval } from "@/lib/pilot.ts";
import s from "./landing.module.css";

const $ = (cents: number, dp = 2) => `$${(cents / 100).toFixed(dp)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ci = (i: Interval) => `${i.k} of ${i.n} · 95% CI ${pct(i.low)}–${pct(i.high)}`;

const REPO = "https://github.com/Pushover-org/pushover";

/** Real sandbox payout items (docs/sandbox-findings.md), play money. */
const SANDBOX = [
  { item: "XM8MDDFPC5G8S", to: "A sandbox buyer, by email", status: "SUCCESS", kind: "ok", note: "$1.00 · fee $0.25" },
  { item: "MQR5FQGFWBUCU", to: "An address with no PayPal account", status: "UNCLAIMED", kind: "wait", note: "returns to the fund after 30 days" },
  { item: "9ZJXXN2QS8KBS", to: "The logged-in account, by PayPal ID", status: "SUCCESS", kind: "ok", note: "$1.00 · fee $0.25" },
  { item: "WJXQ54EN77J3J", to: "A made-up PayPal ID", status: "FAILED", kind: "bad", note: "RECEIVER_ACCOUNT_INVALID · no fee" },
];

export default function Landing() {
  const { claims, summary, run } = loadPilot();
  const { armA, armB, armC } = summary;
  const bad = claims.filter((c) => c.truth !== "honest");
  const stopped = bad.filter((c) => c.outcome !== "APPROVE").length;
  const fooled = claims.filter((c) => c.truth === "fraud" && c.modelAlone === "approve");
  const slipped = fooled.filter((c) => c.outcome === "APPROVE");

  return (
    <>
      <SmoothScroll />
      <Nav />
      <Thread />

      <main id="main">
        {/* 01 · Hero */}
        <section className={s.hero} data-thread="01">
          <div className={`wrap ${s.heroGrid}`}>
            <div className={s.heroCopy}>
              <p className={`label ${s.kicker}`}>
                <span className={s.dot} /> A claims desk for class-action settlements
              </p>
              <h1 className={`display ${s.h1}`}>
                <span className={s.line}>Bots filed half</span>
                <span className={s.line}>the claims.</span>
                <span className={s.line}>
                  Here&apos;s your <em>real</em> share.
                </span>
              </h1>
              <p className={s.lede}>
                Proof of Claim reads every claim&apos;s evidence with AI, lets plain rules (not the model) decide, pays honest claimants straight to their PayPal account, and
                gives leftover money to the court&apos;s chosen charity. Every dollar comes with a written reason.
              </p>
              <div className={s.ctas}>
                <a className="pill pill--green" href="/demo">
                  Open the live demo
                </a>
                <a className="pill pill--quiet" href="/judge">
                  Judges: start here
                </a>
                <a className="pill pill--quiet" href="#pile">
                  See how it decides ↓
                </a>
              </div>
            </div>
            <div className={s.heroCheck}>
              <Check fromCents={armA.honestAverageCheckCents} toCents={armC.honestAverageCheckCents} claims={summary.n} bad={bad.length} stopped={stopped} />
              <p className={s.checkNote}>
                Measured, not mocked: the average honest check in our pilot of {summary.n} labelled claims, when every claim is paid vs. when Proof of Claim decides.
              </p>
            </div>
          </div>

          <div className={`wrap ${s.facts}`}>
            <Fact n="80M" text="fraudulent claims received by one administrator in 2023, up 19,000% since 2021" src="https://www.jonesday.com/en/insights/2024/06/rising-fraudulent-claims-submitted-to-class-action-settlement-funds" who="Jones Day" />
            <Fact n="49%" text="of 1.77 million claims in the Celsius settlement were fraudulent" src="https://frtservices.com/insights/administration-challenges-part-1-fraudulent-claims/" who="FRT" />
            <Fact n="$79B+" text="paid in US class-action settlements in 2025" src="https://blogs.duanemorris.com/classactiondefense/2026/01/08/dmcar-trend-1-settlement-numbers-broke-the-40-billion-mark-for-the-fourth-year-in-a-row/" who="Duane Morris" />
          </div>
        </section>

        {/* 02 · The pile (scroll story) */}
        <Pile claims={claims} checkA={armA.honestAverageCheckCents} checkC={armC.honestAverageCheckCents} />

        {/* 03 · Model said / rules said */}
        <section className={s.section} id="rules" data-thread="03">
          <div className="wrap">
            <Reveal>
              <p className="label">03 · Model said, rules said</p>
              <h2 className={`display ${s.h2}`}>
                Asked alone, the AI approved <em>{fooled.length}</em> of {summary.fraud} fakes.
              </h2>
              <p className={s.sub}>
                We gave the same model the settlement&apos;s rules and one claim at a time, and asked it to approve or deny. Then we let it report findings only, and let
                code decide. Same claims, same model.
              </p>
            </Reveal>

            <Reveal className={s.versus}>
              <div className={s.versusHead}>
                <span className="label">Claim</span>
                <span className="label">What it was</span>
                <span className="label">Model alone</span>
                <span className="label">Proof of Claim</span>
              </div>
              {fooled.map((c) => (
                <div key={c.id} className={s.versusRow} data-outcome={c.outcome}>
                  <span className="num">{c.id}</span>
                  <span>{GROUPS[c.group]?.long}</span>
                  <span className={s.modelSaid}>Approve, pay</span>
                  <span className={s.rulesSaid}>
                    <b>{c.outcome === "NEED_MORE" ? "Need more" : c.outcome.charAt(0) + c.outcome.slice(1).toLowerCase()}</b> {REASON_TEXT[c.reason] ?? c.reason}
                  </span>
                </div>
              ))}
            </Reveal>

            {slipped.length > 0 && (
              <Reveal className={s.slipped}>
                <div>
                  <p className="label">The {slipped.length === 1 ? "one" : slipped.length} that got through</p>
                  <h3 className="display">One person, five names. The first claim looks perfect.</h3>
                </div>
                <p>
                  A flawless claim passes every document check. So now every claim starts with <b>Log in with PayPal</b>: one verified PayPal account, one claim, and the
                  money goes to that exact account. We tested it in PayPal&apos;s sandbox: a payout to the logged-in account&apos;s ID succeeded, and a made-up ID was
                  refused.
                </p>
              </Reveal>
            )}
          </div>
        </section>

        {/* 04 · How it works */}
        <section className={s.section} id="how" data-thread="04">
          <div className="wrap">
            <Reveal>
              <p className="label">04 · How it works</p>
              <h2 className={`display ${s.h2}`}>
                The model reads. <em>The rules decide.</em> PayPal pays.
              </h2>
            </Reveal>
            <Reveal>
            <ol className={s.flow}>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>01</span>
                <h3>Log in with PayPal</h3>
                <p>The claimant signs in with PayPal. One verified account files one claim, so a farm of fake identities has nowhere to send the money.</p>
                <div className={s.mock}>
                  <span className="num">verified_account</span> <b className={s.ok}>true</b>
                  <br />
                  <span className="num">one claim per account</span> <b className={s.ok}>✓</b>
                </div>
              </li>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>02</span>
                <h3>The AI reads the evidence</h3>
                <p>Claude reads the receipt photo and reports what it sees, as structured findings. It has no tool that decides or pays.</p>
                <pre className={s.code}>{`{ "merchant_name": "…",
  "purchase_date": "2018-06-14",
  "subtotal_cents": 1873,
  "tax_cents": 155,
  "total_cents": 2028,
  "anomalies": [] }`}</pre>
              </li>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>03</span>
                <h3>Twelve checks, in code</h3>
                <p>Each check passes, fails, or says it can&apos;t tell. Can&apos;t tell is never a pass.</p>
                <ul className={s.checks}>
                  {CHECK_IDS.map((id) => (
                    <li key={id}>
                      <span className="num">{id}</span> {CHECK_NAMES[id]}
                    </li>
                  ))}
                </ul>
              </li>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>04</span>
                <h3>A versioned rule table decides</h3>
                <p>Approve, deny, ask for one more document, or send to a person. Every decision is stored with its rule and reason, and can never be edited.</p>
                <div className={s.stamps}>
                  <span data-o="APPROVE">Approved</span>
                  <span data-o="DENY">Denied</span>
                  <span data-o="NEED_MORE">Need more</span>
                  <span data-o="REVIEW">Review</span>
                </div>
              </li>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>05</span>
                <h3>PayPal Payouts pays</h3>
                <p>One batch pays every approved claimant. Every item is read back from PayPal, because a payout can fail after it&apos;s accepted.</p>
                <div className={s.mock}>
                  <span className="num">batch 89M2ZCBWVWU82</span> <b className={s.ok}>SUCCESS</b>
                  <br />
                  <span className="num">made-up account</span> <b className={s.bad}>RECEIVER_ACCOUNT_INVALID</b>
                </div>
              </li>
              <li className={s.flowStep}>
                <span className={`num ${s.flowNo}`}>06</span>
                <h3>Leftovers go to charity</h3>
                <p>Unclaimed money comes back after 30 days. With a person&apos;s approval it goes to the court&apos;s chosen nonprofit, a long-standing legal doctrine called cy-près.</p>
              </li>
            </ol>
            </Reveal>
          </div>
        </section>

        {/* 05 · The numbers */}
        <section className={s.section} id="numbers" data-thread="05">
          <div className="wrap">
            <Reveal>
              <p className="label">05 · The numbers</p>
              <h2 className={`display ${s.h2}`}>Three ways to run the same {summary.n} claims.</h2>
              <p className={s.sub}>
                Pre-registered: the claims, their labels and the pass mark were committed to git before any run. Pilot slice, n = {summary.n} ({summary.honest} honest,{" "}
                {summary.fraud} fraud, {summary.ineligible} that don&apos;t qualify). Run <span className="num">{run}</span>.
              </p>
            </Reveal>
            <Reveal className={s.arms}>
              <Arm name="Pay everyone" tag="A" note="Today's default for small no-receipt claims." fraud={armA.fraudCents} denied={armA.honestWronglyDenied} check={armA.honestAverageCheckCents} />
              <Arm name="Model alone" tag="B" note="The AI is asked: approve or deny?" fraud={armB.fraudCents} denied={armB.honestWronglyDenied} check={armB.honestAverageCheckCents} />
              <Arm name="Proof of Claim" tag="C" note="Findings → checks → rules → a person for reviews." fraud={armC.fraudCents} denied={armC.honestWronglyDenied} check={armC.honestAverageCheckCents} lead />
            </Reveal>
            <Reveal>
              <p className={s.footnote}>
                Model alone gives a bigger average check than ours because it wrongly denies {armB.honestWronglyDenied.k} honest people, so fewer share the fund. Proof of
                Claim sends {armC.honestWorkload.k} of {armC.honestWorkload.n} honest claims back for one more document. Even if a person approved every claim sent for
                review, fraud paid would be {$(armC.fraudCentsWorstCase, 0)}. The full 100-claim held-out run comes next; these are pilot numbers.
              </p>
            </Reveal>
          </div>
        </section>

        {/* 06 · Every dollar accounted for */}
        <section className={`${s.section} ${s.money}`} id="money" data-thread="06">
          <div className="wrap">
            <Reveal>
              <p className="label">06 · Every dollar accounted for</p>
              <h2 className={`display ${s.h2}`}>The fund always balances.</h2>
            </Reveal>
            <Reveal className={s.equation}>
              <span className={s.term}>
                <b>fund</b>
              </span>
              <span className={s.op}>=</span>
              <span className={s.term} data-k="paid">
                paid<small>to honest claimants</small>
              </span>
              <span className={s.op}>+</span>
              <span className={s.term}>
                fees<small>$0.25 a payout in our sandbox</small>
              </span>
              <span className={s.op}>+</span>
              <span className={s.term}>
                returned<small>unclaimed after 30 days</small>
              </span>
              <span className={s.op}>+</span>
              <span className={s.term}>
                cy-près<small>to the charity</small>
              </span>
              <span className={s.op}>+</span>
              <span className={s.term}>
                held<small>not yet confirmed</small>
              </span>
            </Reveal>
            <div className={s.moneyGrid}>
            <Reveal>
              <p className={s.sub}>
                Money is whole cents, split pro rata with largest remainders, so nothing is lost to rounding. A payout PayPal hasn&apos;t confirmed is shown as unconfirmed,
                never as paid. The public court report lists every claim&apos;s decision, reason and amount, with personal details masked.
              </p>
            </Reveal>
            <Reveal className={s.sandbox}>
              <p className="label">From PayPal&apos;s sandbox, read back item by item</p>
              <table>
                <thead>
                  <tr>
                    <th>Payout item</th>
                    <th>To</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {SANDBOX.map((r) => (
                    <tr key={r.item}>
                      <td className="num">{r.item}</td>
                      <td>{r.to}</td>
                      <td>
                        <span className={s.status} data-s={r.kind}>
                          {r.status}
                        </span>
                        <small>{r.note}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
            </div>
          </div>
        </section>

        {/* 07 · What it is not */}
        <section className={s.section} data-thread="07">
          <div className={`wrap ${s.nots}`}>
            <Reveal>
              <p className="label">07 · What it is not</p>
              <h2 className={`display ${s.h2}`}>Honest about its limits.</h2>
            </Reveal>
            <Reveal as="ul" className={s.notList}>
              <li>
                <b>Not an &ldquo;AI-made image&rdquo; detector.</b> Those are unreliable. We run consistency checks whose failures can be explained to a court.
              </li>
              <li>
                <b>Not legal advice, and not the administrator.</b> A person approves every review, every distribution, and every dollar sent to charity.
              </li>
              <li>
                <b>Not a chatbot.</b> There is no chat window. The model reports findings; it never decides and never moves money.
              </li>
              <li>
                <b>Not proven at scale yet.</b> Synthetic fakes, a fictional settlement, a small pilot. Every number here says where it came from.
              </li>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className={s.cta} data-thread="08">
          <div className="wrap">
            <Reveal>
              <h2 className={`display ${s.ctaTitle}`}>
                See it decide <em>live.</em>
              </h2>
              <p className={s.sub}>A fictional settlement, real claims from our labelled set, PayPal&apos;s sandbox for the money. File your own claim and watch the rules work.</p>
              <div className={s.ctas}>
                <a className="pill pill--green" href="/demo">
                  Open the live demo
                </a>
                <a className="pill pill--quiet" href="/report/acme-restaurant-beverage">
                  Read the court report
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={`wrap ${s.footGrid}`}>
          <div>
            <div className={s.brand}>
              <span className={s.dot} /> Proof of Claim
            </div>
            <p>The demo settlement, company and nonprofit are fictional. Payments run in PayPal&apos;s sandbox with play money.</p>
          </div>
          <div className={s.footLinks}>
            <a href="/demo">Live demo</a>
            <a href="/claim/acme-restaurant-beverage">File a claim</a>
            <a href="/report/acme-restaurant-beverage">Court report</a>
            <a href={REPO}>Source (MIT)</a>
          </div>
          <p className={s.built}>Built with Claude, PayPal Payouts and Log in with PayPal, and AG Grid.</p>
        </div>
      </footer>
    </>
  );
}

function Fact({ n, text, src, who }: { n: string; text: string; src: string; who: string }) {
  return (
    <a className={s.fact} href={src} target="_blank" rel="noreferrer">
      <span className={`display ${s.factN}`}>{n}</span>
      <span className={s.factText}>{text}</span>
      <span className="label">Source: {who} ↗</span>
    </a>
  );
}

function Arm({ name, tag, note, fraud, denied, check, lead = false }: { name: string; tag: string; note: string; fraud: number; denied: Interval; check: number; lead?: boolean }) {
  return (
    <div className={s.arm} data-lead={lead}>
      <div className={s.armHead}>
        <span className={`num ${s.armTag}`}>{tag}</span>
        <h3>{name}</h3>
        <p>{note}</p>
      </div>
      <dl>
        <div>
          <dt className="label">Paid to fraud</dt>
          <dd className={`display ${s.big}`} data-k="fraud">
            {$(fraud, 0)}
          </dd>
        </div>
        <div>
          <dt className="label">Honest claimants wrongly denied</dt>
          <dd>
            <span className={`display ${s.mid}`}>{pct(denied.rate)}</span>
            <span className={`num ${s.ci}`}>{ci(denied)}</span>
          </dd>
        </div>
        <div>
          <dt className="label">Average honest check</dt>
          <dd className={`display ${s.mid}`}>{$(check)}</dd>
        </div>
      </dl>
    </div>
  );
}
