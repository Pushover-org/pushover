import { CHECK_IDS, DOCUMENT_REQUEST, REASONS } from "@proofofclaim/claims";
import { describe, expect, it } from "vitest";
import { CLAIMANT_STATE } from "./claim-status.ts";
import { LANGS, MESSAGES, pickLang, translator } from "./i18n.ts";
import { en, type MessageKey } from "./messages/en.ts";

const keys = Object.keys(en) as MessageKey[];
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("claimant pages in three languages (C12)", () => {
  it.each(LANGS)("%s has every message, none empty, with the same {slots} as English", (lang) => {
    const m = MESSAGES[lang];
    expect(Object.keys(m).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(m[k].trim().length, k).toBeGreaterThan(0);
      expect(slots(m[k]), `${lang} ${k}`).toEqual(slots(en[k]));
    }
  });

  it("Spanish and Hindi are actually translated, not copies of English", () => {
    for (const lang of ["es", "hi"] as const) {
      const same = keys.filter((k) => MESSAGES[lang][k] === en[k] && /[a-z]{4}/.test(en[k]));
      expect(same, lang).toEqual([]);
    }
  });

  it("has a sentence for every reason code, claimant state, document request and check", () => {
    for (const r of Object.keys(REASONS)) expect(keys, r).toContain(`reason.${r}`);
    for (const st of Object.keys(CLAIMANT_STATE)) {
      expect(keys).toContain(`state.${st}.title`);
      expect(keys).toContain(`state.${st}.detail`);
    }
    for (const c of Object.keys(DOCUMENT_REQUEST)) expect(keys).toContain(`request.${c}`);
    for (const c of CHECK_IDS) expect(keys).toContain(`check.${c}`);
  });

  it("picks the language from the link, then the cookie, then the browser, then English", () => {
    expect(pickLang("hi", "es", "es-MX,es;q=0.9")).toBe("hi");
    expect(pickLang(undefined, "es", "hi-IN")).toBe("es");
    expect(pickLang(undefined, undefined, "fr-FR, hi-IN;q=0.8")).toBe("hi");
    expect(pickLang("xx", "yy", "fr")).toBe("en");
  });

  it("fills {slots}, and leaves a missing one visible", () => {
    const t = translator("es");
    expect(t("status.pleaseSend", { request: "X" })).toBe("Envíe: X");
    expect(t("claim.step2Named")).toBe("Su reclamo, {name}");
  });
});
