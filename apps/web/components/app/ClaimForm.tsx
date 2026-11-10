"use client";
// The claim form. Phone-first: the receipt can be photographed live (capture="environment").
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANG_COOKIE, translator, type Lang } from "@/lib/i18n.ts";
import { US_STATE_NAMES } from "@/lib/states.ts";
import s from "./ClaimForm.module.css";

interface Props {
  lang: Lang;
  settlementId: string;
  states: string[];
  maxUnits: number;
  unitCents: number;
  flatCents: number;
  prefill: { name: string; addressLine: string; city: string; state: string; zip: string };
}

export function ClaimForm({ lang, settlementId, states, maxUnits, unitCents, flatCents, prefill }: Props) {
  const router = useRouter();
  const t = translator(lang);
  const STEPS = [t("form.progress1"), t("form.progress2"), t("form.progress3"), t("form.progress4")];
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
    const timer = window.setInterval(() => setPhase((p) => Math.min(3, p + 1)), 1400);
    return () => window.clearInterval(timer);
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
      const out = (await res.json().catch(() => ({}))) as { statusToken?: string; error?: string };
      if (!res.ok || !out.statusToken) throw new Error(out.error ?? t("form.error"));
      // The status page opens in the language the claim was filed in, even if that came from ?lang=.
      document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
      router.push(`/status/${out.statusToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("form.error"));
      setBusy(false);
    }
  }

  const known = states.includes(prefill.state);
  return (
    <form className={s.form} onSubmit={submit} aria-busy={busy}>
      <fieldset className={s.tiers}>
        <legend className="label">{t("form.haveReceipt")}</legend>
        <button type="button" aria-pressed={tier === "proof"} onClick={() => setTier("proof")}>
          <b>{t("form.yesReceipt")}</b>
          <span>{t("claim.perDrink", { amount: `$${unitCents / 100}`, max: maxUnits })}</span>
        </button>
        <button
          type="button"
          aria-pressed={tier === "no_proof"}
          onClick={() => {
            setTier("no_proof");
            setUnits(1);
          }}
        >
          <b>{t("form.noReceipt")}</b>
          <span>{t("form.flatOnce", { amount: `$${flatCents / 100}` })}</span>
        </button>
      </fieldset>

      {tier === "proof" ? (
        <>
          <div className={s.field}>
            <span className={s.lbl} id="receipt-label">
              {t("form.photo")}
            </span>
            <label className={s.drop} data-has={!!preview}>
              {preview ? <img src={preview} alt={t("form.photoAlt")} /> : <span>{t("form.photoPick")}</span>}
              <input
                ref={fileRef}
                type="file"
                name="receipt"
                accept="image/jpeg,image/png,image/webp,image/gif"
                capture="environment"
                aria-labelledby="receipt-label"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
            </label>
            <span className={s.hint}>{t("form.photoHint")}</span>
          </div>
          <div className={s.field}>
            <span className={s.lbl} id="units-label">
              {t("form.howMany")}
            </span>
            <div className={s.stepper} role="group" aria-labelledby="units-label">
              <button type="button" aria-label={t("form.fewer")} onClick={() => setUnits((u) => Math.max(1, u - 1))}>
                −
              </button>
              <output className="num" aria-live="polite">
                {units}
              </output>
              <button type="button" aria-label={t("form.more")} onClick={() => setUnits((u) => Math.min(maxUnits, u + 1))}>
                +
              </button>
              <span className={s.hint}>{t("form.payFor", { max: maxUnits })}</span>
            </div>
          </div>
        </>
      ) : null}

      <div className={s.row}>
        <label className={s.field}>
          <span className={s.lbl}>{t("form.name")}</span>
          <input name="name" defaultValue={prefill.name} autoComplete="name" required minLength={2} />
        </label>
      </div>
      <label className={s.field}>
        <span className={s.lbl}>{t("form.street")}</span>
        <input name="addressLine" defaultValue={prefill.addressLine} autoComplete="street-address" required />
      </label>
      <div className={s.row3}>
        <label className={s.field}>
          <span className={s.lbl}>{t("form.city")}</span>
          <input name="city" defaultValue={prefill.city} autoComplete="address-level2" />
        </label>
        <label className={s.field}>
          <span className={s.lbl}>{t("form.state")}</span>
          <select name="state" defaultValue={known ? prefill.state : prefill.state || ""} required>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {Object.entries(US_STATE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span className={s.lbl}>{t("form.zip")}</span>
          <input name="zip" defaultValue={prefill.zip} autoComplete="postal-code" inputMode="numeric" pattern="\d{5}(-\d{4})?" required />
        </label>
      </div>
      <label className={s.field}>
        <span className={s.lbl}>{t("form.words")}</span>
        <textarea name="declaration" rows={4} minLength={20} maxLength={2000} required placeholder={t("form.wordsPlaceholder")} />
        <span className={s.hint}>{t("form.wordsHint")}</span>
      </label>
      <label className={s.sworn}>
        <input type="checkbox" name="sworn" value="yes" required />
        <span>{t("form.sworn")}</span>
      </label>

      {error ? (
        <p role="alert" className={s.err}>
          {error}
        </p>
      ) : null}

      <button className={`pill pill--green ${s.submit}`} disabled={busy}>
        {busy ? t("form.deciding") : t("form.submit")}
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
