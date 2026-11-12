// "The examination", the landing page's signature moment (design direction "Exhibit A"): a real
// claim from the test set as evidence. The AI's marks are pencil (graphite, italic: provisional, can
// be wrong); the rule's decision is a stamp in its state ink, with its reason typed underneath. It
// plays once on load and rests in its final state; with reduced motion it is simply the final state.
import type { Exhibit as ExhibitData } from "@/lib/exhibit.ts";
import s from "./Exhibit.module.css";
import { PlayWhenSeen } from "./PlayWhenSeen.tsx";

const money = (cents: number | null) =>
  cents === null ? "—" : (cents / 100).toFixed(2);
const usDate = (iso: string) =>
  `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function Exhibit({ e }: { e: ExhibitData }) {
  const r = e.receipt;
  const [street, ...rest] = r.address.split(", ");
  const drinks = r.lines
    .filter((l) => l.kind === "nonalcoholic_drink")
    .reduce((n, l) => n + (l.qty ?? 1), 0);
  const denied = e.outcome === "DENY";
  const summary = `Claim ${e.claimId}: a receipt from ${r.merchant} (a fictional store), ${usDate(r.date)}, ${drinks} drinks, subtotal $${money(r.subtotal_cents)}, tax $${money(r.tax_cents)}. The AI examiner recommended ${e.model.said} with ${e.model.confidence} confidence. The tax rule ${denied ? "denied it" : "decided"}: ${money(r.tax_cents)} dollars of tax on $${money(r.subtotal_cents)} is ${e.tax.chargedPct}, and ${e.tax.scope} charged ${e.tax.allowedPct} on that date.`;

  return (
    <figure id="exhibit" className={s.exhibit} aria-label={summary}>
      <PlayWhenSeen id="exhibit" />
      <span className={s.tag} aria-hidden>
        Exhibit · claim {e.claimId}
      </span>
      <div className={s.paper}>
        <div className={s.receipt} aria-hidden>
          <p className={s.store}>{r.merchant}</p>
          <p className={s.addr}>
            {street}
            <br />
            {rest.join(", ")}
            <br />
            {usDate(r.date)}
          </p>
          {r.lines.map((l) => (
            <p key={l.desc} className={s.row}>
              <span>{l.qty && l.qty > 1 ? `${l.qty} ${l.desc}` : l.desc}</span>
              <span className={s.amt}>{money(l.line_total_cents)}</span>
              {l.kind === "nonalcoholic_drink" ? (
                <span className={`${s.pencil} ${s.noteDrinks}`}>
                  {drinks} drinks
                </span>
              ) : null}
            </p>
          ))}
          <hr className={s.rule} />
          <p className={s.row}>
            <span>Subtotal</span>
            <span className={s.amt}>{money(r.subtotal_cents)}</span>
          </p>
          <p className={`${s.row} ${s.taxRow}`}>
            <span>Tax</span>
            <span className={s.amt}>
              {money(r.tax_cents)}
              <svg
                className={s.circle}
                viewBox="0 0 100 44"
                preserveAspectRatio="none"
              >
                <path
                  d="M8 26 C 6 8, 70 2, 92 14 C 102 24, 80 40, 44 40 C 14 40, 2 30, 12 16"
                  pathLength="1"
                />
              </svg>
            </span>
            <span className={`${s.pencil} ${s.noteTax}`}>
              {e.tax.chargedPct} tax?
            </span>
          </p>
          <p className={`${s.row} ${s.total}`}>
            <span>Total</span>
            <span className={s.amt}>{money(r.total_cents)}</span>
          </p>
          <p className={`${s.pencil} ${s.model}`}>
            AI:{" "}
            <span className={s.said}>
              {e.model.said}, {e.model.confidence} confidence
            </span>
          </p>
        </div>
        {denied ? (
          <div className={s.stamp} aria-hidden>
            Denied
            <small>Rule C4 · tax</small>
          </div>
        ) : null}
      </div>
      <figcaption className={s.slip}>
        <b>
          {denied ? "Denied: tax rate impossible for that store." : e.reason}
        </b>
        <span className={s.why}>
          {r.tax_cents}¢ on ${money(r.subtotal_cents)}. {e.tax.scope} charged{" "}
          {e.tax.allowedPct} on {longDate(r.date)}.
        </span>
        <span className={s.src}>
          A real claim from our test set. The store is fictional; the reason is
          the rule&apos;s own words.
        </span>
      </figcaption>
    </figure>
  );
}
