"use client";
// The language switcher on the claimant pages (plan item C12). It remembers the choice in a cookie,
// so the status page a claim leads to opens in the same language.
import { usePathname, useRouter } from "next/navigation";
import { LANG_COOKIE, LANGS, MESSAGES, type Lang } from "@/lib/i18n.ts";
import s from "./LangSwitch.module.css";

export function LangSwitch({ lang, label }: { lang: Lang; label: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <nav className={s.switch} aria-label={label}>
      {LANGS.map((l) => (
        <a
          key={l}
          href={`${path}?lang=${l}`}
          lang={l}
          hrefLang={l}
          aria-current={l === lang ? "true" : undefined}
          onClick={(e) => {
            e.preventDefault();
            document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
            router.replace(path);
            router.refresh();
          }}
        >
          {MESSAGES[l]["lang.name"]}
        </a>
      ))}
    </nav>
  );
}
