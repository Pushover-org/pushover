// Claimant pages in English, Spanish or Hindi (plan item C12). The language comes from ?lang=, then
// the poc_lang cookie the switcher sets, then the browser's Accept-Language; English otherwise.
import { en, type MessageKey, type Messages } from "./messages/en.ts";
import { es } from "./messages/es.ts";
import { hi } from "./messages/hi.ts";

export const LANGS = ["en", "es", "hi"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_COOKIE = "poc_lang";
export const MESSAGES: Record<Lang, Messages> = { en, es, hi };

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

export function pickLang(query: string | undefined, cookie: string | undefined, acceptLanguage: string | null): Lang {
  if (isLang(query)) return query;
  if (isLang(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return "en";
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A translator for one language. A `{name}` with no value is left visible, so a gap shows in testing. */
export function translator(lang: Lang): Translate {
  const m = MESSAGES[lang];
  return (key, params) => (m[key] ?? en[key]).replace(/\{(\w+)\}/g, (all, k: string) => (params && k in params ? String(params[k]) : all));
}

export type { MessageKey };
