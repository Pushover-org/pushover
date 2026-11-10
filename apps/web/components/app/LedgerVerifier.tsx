"use client";
// "Verify in my browser" (plan item P43). Everything is recomputed here, with the same code the
// server used (packages/ledger), and the drand beacon is fetched from drand's own relays, not from
// us. Nothing on this page asks you to trust Proof of Claim.
import { auditSample, commitmentDigest, fetchBeacon, merkleRoot, roundTime, SAMPLE_SIZE, type Commitment, type DecisionLeaf } from "@proofofclaim/ledger";
import { useState } from "react";
import s from "./LedgerVerifier.module.css";

interface LedgerJson {
  root: string;
  digest: string;
  commitment: Commitment;
  leaves: DecisionLeaf[];
  drandRound: number;
  sample: string[] | null;
  paypalNotes: { paypalBatchId: string | null; senderItemId: string; note: string | null }[];
}

type Step = { name: string; status: "pass" | "fail" | "wait"; detail: string };

export function LedgerVerifier({ url }: { url: string }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setSteps(null);
    const t0 = performance.now();
    const out: Step[] = [];
    const add = (name: string, status: Step["status"], detail: string) => out.push({ name, status, detail });
    try {
      const j = (await fetch(url, { cache: "no-store" }).then((r) => r.json())) as LedgerJson;
      const root = merkleRoot(j.leaves);
      add("Every decision hashes to the committed root", root === j.root && root === j.commitment.root ? "pass" : "fail",
        root === j.commitment.root ? `${j.leaves.length} decisions → ${root.slice(0, 16)}…` : `recomputed ${root.slice(0, 16)}…, committed ${j.commitment.root.slice(0, 16)}…`);
      const digest = commitmentDigest(j.commitment);
      add("The commitment's digest matches", digest === j.digest ? "pass" : "fail", `sha256 ${digest.slice(0, 16)}… covers the root, the rules, the plan and the drand round`);
      const read = j.paypalNotes.filter((n) => n.note !== null);
      if (read.length === 0) add("PayPal's record names this ledger", "wait", `${j.paypalNotes.length} payouts, not read back from PayPal yet`);
      else {
        const naming = read.filter((n) => n.note?.includes(`ledger sha256:${digest}`)).length;
        add("PayPal's record names this ledger", naming === read.length ? "pass" : "fail", `${naming} of ${read.length} payouts read back from PayPal carry this digest in their note`);
      }
      const published = roundTime(j.drandRound);
      const committed = new Date(j.commitment.committedAt);
      add("The drand round didn't exist when the root was fixed", published > committed ? "pass" : "fail",
        `round ${j.drandRound} is published ${Math.round((published.getTime() - committed.getTime()) / 1000)} s after the commitment`);
      let randomness: string | null = null;
      if (published.getTime() > Date.now()) add("drand's beacon, from drand's relays", "wait", `round ${j.drandRound} comes out in ${Math.ceil((published.getTime() - Date.now()) / 1000)} s`);
      else {
        try {
          const b = await fetchBeacon(j.drandRound);
          if (!b) add("drand's beacon, from drand's relays", "wait", `round ${j.drandRound} isn't on the relays yet`);
          else {
            randomness = b.randomness;
            add("drand's beacon, from drand's relays", "pass", `round ${b.round} verified against quicknet's public key (BLS)`);
          }
        } catch (err) {
          add("drand's beacon, from drand's relays", "fail", err instanceof Error ? err.message : "no relay answered with a valid beacon");
        }
      }
      if (randomness) {
        const sample = auditSample(j.leaves, j.root, randomness, Math.min(SAMPLE_SIZE, j.leaves.length));
        const same = j.sample === null || j.sample.join() === sample.join();
        add("The audit sample nobody could pick", same ? "pass" : "fail", `${sample.join(", ")}${j.sample === null ? " (the server hasn't recorded it yet)" : same ? ", as recorded" : `; recorded ${j.sample.join(", ")}`}`);
      } else add("The audit sample nobody could pick", "wait", "drawn from the drand beacon once it's out");
    } catch (err) {
      add("Read the ledger", "fail", err instanceof Error ? err.message : "couldn't read it");
    }
    setSteps(out);
    setMs(Math.round(performance.now() - t0));
    setBusy(false);
  }

  const failed = steps?.some((x) => x.status === "fail");
  const waiting = steps?.some((x) => x.status === "wait");
  return (
    <div className={s.box}>
      <button className="pill pill--quiet" onClick={run} disabled={busy}>
        {busy ? "Checking…" : steps ? "Check again" : "Verify in my browser"}
      </button>
      {steps ? (
        <div className={s.result} data-state={failed ? "fail" : waiting ? "wait" : "pass"} role="status">
          <p className={s.verdict}>
            {failed ? "FAILED: this ledger doesn't check out." : waiting ? "Checks so far pass; some wait on PayPal or drand." : "Every check passes."}{" "}
            <span className="num">{ms} ms</span>
          </p>
          <ol>
            {steps.map((x) => (
              <li key={x.name} data-s={x.status}>
                <b>{x.status === "pass" ? "PASS" : x.status === "fail" ? "FAIL" : "WAIT"}</b> {x.name}: <span>{x.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
