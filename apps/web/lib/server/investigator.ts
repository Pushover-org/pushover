// The investigator's wiring for the web app: the model from the environment, the shared AI
// budget, and recorded answers replayed first (plan item P30), so the demo and CI need no key.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { AnswersSchema, CostGuard, type Answers, type InvestigatorDeps } from "@proofofclaim/examiner";

/** Recorded answers, by the SHA-256 of the exact facts shown (data/replay/investigations.json). */
export const REPLAY_FILE = "data/replay/investigations.json";

let replayCache: Map<string, Answers> | null = null;
export function replay(): (factsSha256: string) => Answers | null {
  if (!replayCache) {
    replayCache = new Map();
    const file = path.resolve(process.cwd(), "../..", REPLAY_FILE);
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      for (const [sha, a] of Object.entries(raw)) {
        const ok = AnswersSchema.safeParse(a);
        if (ok.success) replayCache.set(sha, ok.data);
      }
    }
  }
  const m = replayCache;
  return (sha) => m.get(sha) ?? null;
}

const g = globalThis as unknown as { __pocInvestigatorGuard?: CostGuard };

export function investigatorDeps(): InvestigatorDeps | null {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return null;
  g.__pocInvestigatorGuard ??= new CostGuard(Number(process.env["DEMO_AI_BUDGET_USD"] ?? "1"), 0);
  return { client: new Anthropic({ apiKey: key }), model: process.env["PUSHOVER_MODEL"] ?? "claude-haiku-5-5", guard: g.__pocInvestigatorGuard };
}
