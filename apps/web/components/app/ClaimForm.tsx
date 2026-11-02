"use client";
// The claim form. Phone-first: the receipt can be photographed live (capture="environment").
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { US_STATE_NAMES } from "@/lib/states.ts";
import s from "./ClaimForm.module.css";

interface Props {
  settlementId: string;
  states: string[];
  maxUnits: number;
  unitCents: number;
  flatCents: number;
  prefill: { name: string; addressLine: string; city: string; state: string; zip: string };
}

const STEPS = ["Reading your receipt", "Checking dates, totals and tax", "Comparing with every other claim", "Applying the rules"];

export function ClaimForm({ settlementId, states, maxUnits, unitCents, flatCents, prefill }: Props) {
  const router = useRouter();
  const [tier, setTier] = useState<"proof" | "no_proof">("proof");
  const [units, setUnits] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setPhase((p) => Math.min(STEPS.length - 1, p + 1)), 1400);
    return () => window.clearInterval(t);
  }, [busy]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    data.set("tier", tier);
    data.set("units", String(units));
    data.set("settlement", settlementId);
    if (tier === "no_proof") data.delete("receipt");
    setBusy(true);
    setPhase(0);
    try {
      const res = await fetch("/api/claims", { method: "POST", body: data });
      const out = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !out.id) throw new Error(out.error ?? "Something went wrong. Please try again.");
      router.push(`/claim/${settlementId}/r/${out.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const known = states.includes(prefill.state);
  return (
    <form className={s.form} onSubmit={submit} aria-busy={busy}>
      <fieldset className={s.tiers}>
        <legend className="label">Do you have a receipt?</legend>
        <button type="button" aria-pressed={tier === "proof"} onClick={() => setTier("proof")}>
          <b>Yes, I have one</b>
          <span>
            ${unitCents / 100} a drink, up to {maxUnits}
          </span>
        </button>
        <button type="button" aria-pressed={tier === "no_proof"} onClick={() => setTier("no_proof")}>
          <b>No receipt</b>
          <span>${flatCents / 100} flat, once</span>
        </button>
      </fieldset>

      {tier === "proof" ? (
        <>
          <div className={s.field}>
            <span className={s.lbl}>Photo of the receipt</span>
            <label className={s.drop} data-has={!!preview}>
              {preview ? <img src={preview} alt="Your receipt" /> : <span>Take a photo or choose a file</span>}
              <input
                ref={fileRef}
                type="file"
                name="receipt"
                accept="image/jpeg,image/png,image/webp,image/gif"
                capture="environment"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
            </label>
            <span className={s.hint}>JPEG or PNG, up to 8 MB. The whole receipt, flat and in focus.</span>
          </div>
          <div className={s.field}>
            <span className={s.lbl} id="units-label">
              How many drinks does it show?
            </span>
            <div className={s.stepper} role="group" aria-labelledby="units-label">
              <button type="button" aria-label="One fewer" onClick={() => setUnits((u) => Math.max(1, u - 1))}>
                −
              </button>
              <output className="num" aria-live="polite">
                {units}
              </output>
              <button type="button" aria-label="One more" onClick={() => setUnits((u) => Math.min(maxUnits, u + 1))}>
                +
              </button>
              <span className={s.hint}>We pay for the drinks the receipt shows, up to {maxUnits}.</span>
            </div>
          </div>
        </>
      ) : null}

      <div className={s.row}>
        <label className={s.field}>
          <span className={s.lbl}>Full name</span>
          <input name="name" defaultValue={prefill.name} autoComplete="name" required minLength={2} />
        </label>
      </div>
      <label className={s.field}>
        <span className={s.lbl}>Street address</span>
        <input name="addressLine" defaultValue={prefill.addressLine} autoComplete="street-address" required />
      </label>
      <div className={s.row3}>
        <label className={s.field}>
          <span className={s.lbl}>City</span>
          <input name="city" defaultValue={prefill.city} autoComplete="address-level2" />
        </label>
        <label className={s.field}>
          <span className={s.lbl}>State</span>
          <select name="state" defaultValue={known ? prefill.state : prefill.state || ""} required>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(US_STATE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span className={s.lbl}>ZIP</span>
          <input name="zip" defaultValue={prefill.zip} autoComplete="postal-code" inputMode="numeric" pattern="\d{5}(-\d{4})?" required />
        </label>
      </div>
      <label className={s.field}>
        <span className={s.lbl}>In your own words: what did you buy, where and when?</span>
        <textarea name="declaration" rows={4} minLength={20} maxLength={2000} required placeholder="I had an iced tea with lunch at a diner on Main Street in Austin in spring 2017." />
        <span className={s.hint}>Write it yourself. Declarations copied from a template are held for a person to check.</span>
      </label>
      <label className={s.sworn}>
        <input type="checkbox" name="sworn" value="yes" required />
        <span>I declare under penalty of perjury that this is true and that I haven&apos;t filed another claim in this settlement.</span>
      </label>

      {error ? (
        <p role="alert" className={s.err}>
          {error}
        </p>
      ) : null}

      <button className={`pill pill--green ${s.submit}`} disabled={busy}>
        {busy ? "Deciding…" : "File my claim"}
      </button>

      {busy ? (
        <ol className={s.progress} aria-live="polite">
          {STEPS.filter((_, i) => tier === "proof" || i > 0).map((t, i) => (
            <li key={t} data-state={i < phase ? "done" : i === phase ? "now" : "next"}>
              {t}
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  );
}
