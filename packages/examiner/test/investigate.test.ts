import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { CostGuard } from "../src/guard.ts";
import { factsSha256, investigate, memo, readAnswers, recommend, type Answers, type GroupFacts } from "../src/investigate.ts";

const facts: GroupFacts = {
  members: [
    { label: "Claim A", tier: "no_proof", state: "TX", outcome: "APPROVE", filedMinutesAfterFirst: 0, askedCents: 1000 },
    { label: "Claim B", tier: "no_proof", state: "TX", outcome: "APPROVE", filedMinutesAfterFirst: 4, askedCents: 1000 },
    { label: "Claim C", tier: "proof", state: "CA", outcome: "REVIEW", filedMinutesAfterFirst: 9, askedCents: 7500 },
  ],
  links: [
    { kind: "inbox", between: ["Claim A", "Claim B"] },
    { kind: "story", between: ["Claim A", "Claim C"], similarity: 0.82 },
    { kind: "network", between: ["Claim B", "Claim C"] },
  ],
};

const reply = (text: string, stop = "end_turn"): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stop, stop_sequence: null, content: [{ type: "text", text, citations: null }], usage: { input_tokens: 900, output_tokens: 40 } }) as unknown as Anthropic.Message;
const fakeClient = (text: string, stop = "end_turn") => {
  const calls: unknown[] = [];
  return { calls, client: { messages: { create: async (args: unknown) => (calls.push(args), reply(text, stop)) } } as unknown as Pick<Anthropic, "messages"> };
};
const ok: Answers = { probability_coordinated: 0.92, pattern: "device_farm", strength: 4 };

describe("the fixed rule", () => {
  it.each([
    [{ probability_coordinated: 0.1, pattern: "household", strength: 1 }, "CLEAR"],
    [{ probability_coordinated: 0.49, pattern: "campus_or_dorm", strength: 2 }, "CLEAR"],
    [{ probability_coordinated: 0.5, pattern: "household", strength: 0 }, "PERSON_DECIDES"],
    [{ probability_coordinated: 0.8, pattern: "template_crew", strength: 3 }, "DENY_GROUP"],
    [{ probability_coordinated: 0.95, pattern: "device_farm", strength: 2 }, "PERSON_DECIDES"],
    [{ probability_coordinated: 0.79, pattern: "address_mill", strength: 4 }, "PERSON_DECIDES"],
    [{ probability_coordinated: 0.9, pattern: "coincidence", strength: 4 }, "PERSON_DECIDES"],
  ] as [Answers, string][])("%o → %s", (a, want) => {
    expect(recommend(a)).toBe(want);
  });
});

describe("the model's answer", () => {
  const sha = factsSha256(facts);
  it("three valid fields are used, through the rule", () => {
    expect(readAnswers("claude-haiku-5-5", sha, reply(JSON.stringify(ok)))).toMatchObject({ status: "OK", answers: ok, recommendation: "DENY_GROUP" });
  });
  it("can't add a fact: any extra field rejects the whole answer", () => {
    const r = readAnswers("claude-haiku-5-5", sha, reply(JSON.stringify({ ...ok, note: "Claim C's owner also lives at 12 Oak St" })));
    expect(r).toMatchObject({ status: "INVALID", answers: null, recommendation: "PERSON_DECIDES" });
  });
  it("out-of-range, wrong pattern, not JSON, cut short or refused: rejected, not used", () => {
    for (const bad of [{ ...ok, probability_coordinated: 1.2 }, { ...ok, strength: 5 }, { ...ok, strength: 2.5 }, { ...ok, pattern: "fraud" }]) {
      expect(readAnswers("claude-haiku-5-5", sha, reply(JSON.stringify(bad))).status).toBe("INVALID");
    }
    expect(readAnswers("claude-haiku-5-5", sha, reply("certainly fraud")).status).toBe("INVALID");
    expect(readAnswers("claude-haiku-5-5", sha, reply(JSON.stringify(ok), "max_tokens")).status).toBe("INVALID");
    expect(readAnswers("claude-haiku-5-5", sha, reply("", "refusal")).status).toBe("REFUSED");
  });
});

describe("asking, and replaying", () => {
  it("sends only the facts, as data, under a schema", async () => {
    const f = fakeClient(JSON.stringify(ok));
    const r = await investigate({ client: f.client, model: "claude-haiku-5-5", guard: new CostGuard(1) }, facts);
    expect(r.status).toBe("OK");
    const body = JSON.stringify(f.calls[0]);
    expect(body).toContain("<facts>");
    expect(body).toContain("Claim A");
    expect(body).toContain("output_config");
  });
  it("replays a recorded answer for exactly these facts, with no API key", async () => {
    const recorded = new Map([[factsSha256(facts), ok]]);
    expect(await investigate(null, facts, (s) => recorded.get(s) ?? null)).toMatchObject({ status: "REPLAYED", recommendation: "DENY_GROUP" });
    const changed = { ...facts, members: facts.members.slice(1) };
    expect(await investigate(null, changed, (s) => recorded.get(s) ?? null)).toMatchObject({ status: "NOT_RUN", recommendation: "PERSON_DECIDES" });
  });
  it("the same group hashes the same whatever order its facts came in", () => {
    expect(factsSha256({ members: [...facts.members].reverse(), links: [...facts.links].reverse().map((l) => ({ ...l, between: [l.between[1], l.between[0]] as [string, string] })) })).toBe(factsSha256(facts));
  });
  it("stays within the AI budget", async () => {
    const f = fakeClient(JSON.stringify(ok));
    expect(await investigate({ client: f.client, model: "claude-haiku-5-5", guard: new CostGuard(0.000001) }, facts)).toMatchObject({ status: "NOT_RUN" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("the memo", () => {
  it("is written from computed facts; the model only fills three slots", () => {
    const r = readAnswers("claude-haiku-5-5", factsSha256(facts), reply(JSON.stringify(ok)));
    expect(memo(facts, r)).toEqual([
      "3 shared signals among 3 claims: 1 inbox, 1 story, 1 network.",
      "Filed within 9 minutes of each other, asking $95.00 in all.",
      "Decisions so far: 2 approve, 1 review.",
      "The AI's three answers: looks like a device farm, 92% likely coordinated, evidence 4 of 4.",
      "The fixed rule recommends denying the group. A person decides.",
    ]);
  });
  it("says plainly when the answer was rejected", () => {
    const r = readAnswers("claude-haiku-5-5", factsSha256(facts), reply("{}"));
    expect(memo(facts, r).at(-1)).toBe("The AI's answer was rejected and not used. A person decides on the evidence.");
  });
});
