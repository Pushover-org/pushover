"use client";
import { useActionState } from "react";
import { createSettlement } from "@/app/(app)/admin/new/actions.ts";
import f from "./ClaimForm.module.css";
import s from "./NewSettlementForm.module.css";

/** The fields of a settlement (SettlementSchema). The server validates everything again. */
export function NewSettlementForm({ states }: { states: [string, string][] }) {
  const [state, action, pending] = useActionState(createSettlement, { error: null });
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={f.field}>
      <span className={f.lbl}>{label}</span>
      <input name={name} required {...props} />
    </label>
  );
  return (
    <form action={action} className={s.form}>
      <fieldset className={s.group}>
        <legend className="label">The settlement</legend>
        <div className={s.row}>
          {field("id", "ID (lower case, dashes)", { pattern: "[a-z0-9]+(-[a-z0-9]+)*", placeholder: "acme-bottle-settlement", maxLength: 64 })}
          {field("name", "Name", { placeholder: "Acme Bottle Settlement", maxLength: 180 })}
        </div>
        <div className={s.row}>
          {field("fund", "Fund ($)", { inputMode: "decimal", placeholder: "50000" })}
          {field("reserve", "Admin reserve ($)", { inputMode: "decimal", placeholder: "2500" })}
        </div>
        <div className={s.row}>
          {field("periodStart", "Class period from", { type: "date" })}
          {field("periodEnd", "to", { type: "date" })}
        </div>
      </fieldset>
      <fieldset className={s.group}>
        <legend className="label">What qualifies</legend>
        <div className={s.row}>
          {field("productId", "Product ID", { pattern: "[a-z0-9]+(-[a-z0-9]+)*", placeholder: "insulated-bottle", maxLength: 64 })}
          {field("productName", "Product name", { placeholder: "Insulated water bottle", maxLength: 200 })}
        </div>
        {field("productDescription", "What counts (the examiner matches receipt lines against this)", { placeholder: "Any Acme-brand insulated bottle", maxLength: 1000 })}
        <div className={f.field}>
          <span className={f.lbl}>Class states</span>
          <div className={s.states}>
            {states.map(([code, name]) => (
              <label key={code} title={name}>
                <input type="checkbox" name="states" value={code} /> {code}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <fieldset className={s.group}>
        <legend className="label">What a claim pays</legend>
        <div className={s.row3}>
          {field("unit", "With proof: $ per unit", { inputMode: "decimal", placeholder: "15" })}
          {field("maxUnits", "up to units", { type: "number", min: 1, max: 1000, placeholder: "5" })}
          {field("flat", "Without proof: $ flat", { inputMode: "decimal", placeholder: "10" })}
        </div>
      </fieldset>
      <fieldset className={s.group}>
        <legend className="label">Money that can&apos;t be delivered (cy-près)</legend>
        <div className={s.row}>
          {field("cyPresName", "Nonprofit the court chose", { placeholder: "Clean Water Access Fund", maxLength: 180 })}
          {field("cyPresEmail", "Its PayPal email (sandbox)", { type: "email", placeholder: "po-merchant-baseline-3h8w@business.example.com" })}
        </div>
      </fieldset>
      <fieldset className={s.group}>
        <legend className="label">Filing</legend>
        <div className={s.row}>
          <label className={f.field}>
            <span className={f.lbl}>Filing closes (optional; end of that day, UTC)</span>
            <input name="closesOn" type="date" />
          </label>
          <label className={f.sworn}>
            <input type="checkbox" name="decideAfterClose" />
            <span>Decide every claim together once filing closes, so the cluster checks see them all</span>
          </label>
        </div>
      </fieldset>
      {state.error ? (
        <p role="alert" className={f.err}>
          {state.error}
        </p>
      ) : null}
      <button className={`pill pill--green ${f.submit}`} disabled={pending}>
        {pending ? "Checking…" : "Open the settlement"}
      </button>
    </form>
  );
}
