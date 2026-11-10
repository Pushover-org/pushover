import { describe, expect, it } from "vitest";
import { FILED_BY_KEY, filedByKind, filedByLabel, type FiledByKind } from "./filed-by.ts";
import { MESSAGES } from "./i18n.ts";

const KINDS: FiledByKind[] = ["FORM", "ASSISTANT_WAITING", "ASSISTANT_CONFIRMED", "ASSISTANT_LAPSED"];

describe("who filed a claim (P11, P14)", () => {
  it("tells the form, a waiting assistant filing, a confirmed one and a closed one apart", () => {
    expect(filedByKind({ filedVia: "FORM", boundAt: null, status: "APPROVE" })).toBe("FORM");
    expect(filedByKind({ filedVia: "ASSISTANT", boundAt: null, status: "UNBOUND" })).toBe("ASSISTANT_WAITING");
    expect(filedByKind({ filedVia: "ASSISTANT", boundAt: "2026-11-10T10:00:00Z", status: "APPROVE" })).toBe("ASSISTANT_CONFIRMED");
    expect(filedByKind({ filedVia: "ASSISTANT", boundAt: null, status: "LAPSED" })).toBe("ASSISTANT_LAPSED");
  });

  it("every kind has words on the desk and in every claimant language", () => {
    for (const k of KINDS) {
      const l = filedByLabel(k, "Helper", "2026-11-10T10:00:00Z");
      expect(l.short.length).toBeGreaterThan(3);
      expect(l.long.length).toBeGreaterThan(20);
      for (const lang of ["en", "es", "hi"] as const) expect(MESSAGES[lang][FILED_BY_KEY[k]], `${lang} ${k}`).toBeTruthy();
    }
  });

  it("an assistant's name is shown as the name it gave, never as verified", () => {
    for (const k of KINDS.filter((x) => x !== "FORM")) {
      expect(filedByLabel(k, "Helper").long).toMatch(/gave its name as "Helper"/);
      expect(MESSAGES.en[FILED_BY_KEY[k]]).toMatch(/gave its name as/);
    }
  });

  it("a waiting filing never reads as done", () => {
    expect(filedByLabel("ASSISTANT_WAITING", "Helper").long).toMatch(/not read, decided or payable/);
    expect(filedByLabel("ASSISTANT_WAITING", "Helper").short).not.toMatch(/confirmed|approved|paid|safe/i);
  });
});
