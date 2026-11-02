"use client";
// "The pile": the 32 pilot claims, read, checked, stamped and sorted as the reader scrolls.
// Every card is a real claim from the R9 pilot, with the outcome the system actually gave it.
import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { GROUPS, REASON_TEXT, type PilotClaim } from "@/lib/pilot-shared.ts";
import styles from "./Pile.module.css";

const STAMP: Record<PilotClaim["outcome"], string> = { APPROVE: "Approved", DENY: "Denied", REVIEW: "Review", NEED_MORE: "Need more" };

/** A fixed, messy starting position for card i, so server and client render the same. */
function scatter(i: number): Record<string, string> {
  const r = (n: number) => (Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  return { "--px": `${(r(1) * 220 - (i % 8) * 40 + 140).toFixed(0)}px`, "--py": `${(r(2) * 120 - Math.floor(i / 8) * 90 + 120).toFixed(0)}px`, "--pr": `${(r(3) * 40).toFixed(1)}deg` };
}

interface Props {
  claims: PilotClaim[];
  checkA: number;
  checkC: number;
}

export function Pile({ claims, checkA, checkC }: Props) {
  const section = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(true);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let raf = 0;
    // Deal the pile in only if the reader hasn't reached it yet (no flash on reload mid-page).
    if (el.getBoundingClientRect().top > window.innerHeight * 0.55 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setArrived(false);
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.55) setArrived(true);
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 1;
      setStep(Math.min(3, Math.floor(p * 4.2)));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const paidA = claims.map((c) => c.claimedCents);
  const paidC = claims.map((c) => (c.outcome === "APPROVE" ? c.cents : 0));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const honestShare = (paid: number[]) => sum(paid.filter((_, i) => claims[i]?.truth === "honest")) / Math.max(1, sum(paid));
  const done = step >= 3;
  const paid = done ? paidC : paidA;
  const total = sum(paid);
  const tally = (o: PilotClaim["outcome"]) => (step >= 2 ? claims.filter((c) => c.outcome === o).length : 0);
  const fraudA = sum(claims.map((c, i) => (c.truth !== "honest" ? (paidA[i] ?? 0) : 0)));
  const fraudC = sum(claims.map((c, i) => (c.truth !== "honest" ? (paidC[i] ?? 0) : 0)));

  const steps = [
    {
      title: <>{claims.length} claims arrive.</>,
      body: (
        <>
          A pilot slice of our labelled claim set: {claims.filter((c) => c.truth === "honest").length} honest, {claims.filter((c) => c.truth === "fraud").length} fraudulent and{" "}
          {claims.filter((c) => c.truth === "ineligible").length} that don&apos;t qualify. Pay everyone, and only <b className="num">{Math.round(honestShare(paidA) * 100)}¢</b> of each dollar
          reaches an honest person.
        </>
      ),
    },
    {
      title: <>The AI reads every receipt.</>,
      body: <>Claude reports what each receipt says: the store, date, items, tax and total. It reports findings only. It never decides a claim and never touches money.</>,
    },
    {
      title: <>Twelve checks. Code decides.</>,
      body: (
        <>
          Dates, arithmetic, the tax rate for the store&apos;s state, reused photos, bot-written declarations, repeat identities. A check that can&apos;t confirm something says
          UNKNOWN, and <b>unknown is never a pass</b>.
        </>
      ),
    },
    {
      title: (
        <>
          Here&apos;s the <em>real</em> share.
        </>
      ),
      body: (
        <>
          Money paid to bad claims fell from <b className="num">${(fraudA / 100).toFixed(0)}</b> to <b className="num">${(fraudC / 100).toFixed(0)}</b>. Now{" "}
          <b className="num">{Math.round(honestShare(paidC) * 100)}¢</b> of each dollar reaches an honest person. One honest receipt was denied: its printed numbers really
          don&apos;t add up.
        </>
      ),
    },
  ];

  return (
    <section ref={section} className={styles.section} id="pile" aria-labelledby="pile-title" data-step={step} data-arrived={arrived}>
      <div className={styles.sticky}>
        <div className={`wrap ${styles.grid}`}>
          <div className={styles.copy}>
            <p className="label" id="pile-title">
              02 · The pile
            </p>
            <ol className={styles.steps}>
              {steps.map((s, i) => (
                <li key={i} className={styles.step} data-active={i === step} aria-current={i === step ? "step" : undefined}>
                  <span className={`num ${styles.stepNo}`}>0{i + 1}</span>
                  <h3 className="display">{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className={styles.board}>
            <div className={styles.scan} aria-hidden />
            <ul className={styles.cards} aria-label="The 32 pilot claims and what happened to each">
              {claims.map((c, i) => (
                <li
                  key={c.id}
                  className={styles.card}
                  data-outcome={c.outcome}
                  data-truth={c.truth}
                  data-tier={c.tier}
                  style={{ "--i": i, ...scatter(i) } as React.CSSProperties}
                  title={`${c.id} · ${GROUPS[c.group]?.long ?? c.group} → ${STAMP[c.outcome]}: ${REASON_TEXT[c.reason] ?? c.reason}`}
                >
                  <span className={`num ${styles.id}`}>{c.id}</span>
                  <span className={styles.grp}>{GROUPS[c.group]?.short ?? c.group}</span>
                  <span className={styles.read} aria-hidden>
                    {c.tier === "proof" ? "read ✓" : "no receipt"}
                  </span>
                  <span className={styles.stamp}>{STAMP[c.outcome]}</span>
                  <span className="sr-only">
                    {GROUPS[c.group]?.long}. Outcome: {STAMP[c.outcome]}, {REASON_TEXT[c.reason] ?? c.reason}.
                  </span>
                </li>
              ))}
            </ul>

            <div className={styles.ledger}>
              <div className={styles.tally}>
                {(["APPROVE", "DENY", "REVIEW", "NEED_MORE"] as const).map((o) => (
                  <div key={o} className={styles.tallyItem} data-outcome={o}>
                    <NumberFlow value={tally(o)} className={`num ${styles.tallyNum}`} />
                    <span className="label">{STAMP[o]}</span>
                  </div>
                ))}
              </div>
              <div className={styles.bar} role="img" aria-label={`Where the money goes: ${Math.round(honestShare(paid) * 100)} cents of each dollar to honest claimants`}>
                {claims.map((c, i) => (
                  <span key={c.id} className={styles.slice} data-truth={c.truth} style={{ flexGrow: paid[i] ?? 0 }} />
                ))}
              </div>
              <div className={styles.barLegend}>
                <span>
                  <i data-truth="honest" /> Honest
                </span>
                <span>
                  <i data-truth="fraud" /> Fraud
                </span>
                <span>
                  <i data-truth="ineligible" /> Doesn&apos;t qualify
                </span>
                <span className={styles.barTotal}>
                  paid <span className="num">${(total / 100).toFixed(0)}</span>
                </span>
              </div>
              <div className={styles.miniCheck}>
                <span className="label">Average honest check</span>
                <span className={styles.miniAmount}>
                  $<NumberFlow value={(done ? checkC : checkA) / 100} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} className="num" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
