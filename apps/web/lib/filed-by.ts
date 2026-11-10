// Who filed a claim (plan items P11, P14): the claimant on the form, or an assistant under the name
// it gave itself. An assistant's name is self-declared and never verified, so every label says it
// was the name it gave. A filing waiting for its person reads as waiting, never as done.
export type FiledByKind = "FORM" | "ASSISTANT_WAITING" | "ASSISTANT_CONFIRMED" | "ASSISTANT_LAPSED";

export function filedByKind(c: { filedVia: "FORM" | "ASSISTANT"; boundAt: string | Date | null; status: string }): FiledByKind {
  if (c.filedVia === "FORM") return "FORM";
  if (c.boundAt) return "ASSISTANT_CONFIRMED";
  return c.status === "LAPSED" ? "ASSISTANT_LAPSED" : "ASSISTANT_WAITING";
}

const day = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** For the analysts' screens (English, like the rest of the desk). */
export function filedByLabel(kind: FiledByKind, agent: string | null, boundAt: string | Date | null = null): { short: string; long: string } {
  const named = `"${agent ?? "unnamed"}"`;
  switch (kind) {
    case "FORM":
      return { short: "Claimant", long: "The claimant, on the claim form" };
    case "ASSISTANT_WAITING":
      return { short: `${named} · waiting`, long: `An assistant that gave its name as ${named}. Waiting for its person to log in with PayPal and confirm; until then it is not read, decided or payable.` };
    case "ASSISTANT_CONFIRMED":
      return { short: `${named} · confirmed`, long: `An assistant that gave its name as ${named}, confirmed by its person with PayPal on ${day(boundAt)}.` };
    case "ASSISTANT_LAPSED":
      return { short: `${named} · never confirmed`, long: `An assistant that gave its name as ${named}. Nobody confirmed it, so it closed without being read, decided or paid.` };
  }
}

/** The claimant pages' message key for each kind (lib/messages: filedBy.*). */
export const FILED_BY_KEY = {
  FORM: "filedBy.FORM",
  ASSISTANT_WAITING: "filedBy.ASSISTANT_WAITING",
  ASSISTANT_CONFIRMED: "filedBy.ASSISTANT_CONFIRMED",
  ASSISTANT_LAPSED: "filedBy.ASSISTANT_LAPSED",
} as const satisfies Record<FiledByKind, string>;
