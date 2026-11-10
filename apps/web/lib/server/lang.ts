import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLang, translator, type Lang, type Translate } from "../i18n.ts";

/** The claimant's language for this request, and its translator. */
export async function claimantLang(query: string | undefined): Promise<{ lang: Lang; t: Translate }> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  const lang = pickLang(query, c.get(LANG_COOKIE)?.value, h.get("accept-language"));
  return { lang, t: translator(lang) };
}
