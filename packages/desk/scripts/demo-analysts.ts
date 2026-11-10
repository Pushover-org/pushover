// The two sandbox logins judges use on the demo: an analyst who proposes a payout round and a
// supervisor who approves it. Their passwords come from the deployment's environment and are
// shown on /judge, like the sandbox buyer logins: they guard play money only, and the demo's daily
// sandbox cap still applies. Safe to run again; it resets both.
//   JUDGE_ANALYST_PASSWORD=… JUDGE_SUPERVISOR_PASSWORD=… pnpm demo:analysts
import { createPool } from "@proofofclaim/db";
import { setAnalyst } from "../src/index.ts";

const JUDGE_ANALYST = { email: "analyst@judges.example", name: "Demo Analyst", role: "analyst" } as const;
const JUDGE_SUPERVISOR = { email: "supervisor@judges.example", name: "Demo Supervisor", role: "supervisor" } as const;

const analystPassword = process.env["JUDGE_ANALYST_PASSWORD"];
const supervisorPassword = process.env["JUDGE_SUPERVISOR_PASSWORD"];
if (!analystPassword || !supervisorPassword) {
  console.error("set JUDGE_ANALYST_PASSWORD and JUDGE_SUPERVISOR_PASSWORD (12+ characters each)");
  process.exit(2);
}
const pool = createPool();
try {
  for (const [who, password] of [[JUDGE_ANALYST, analystPassword], [JUDGE_SUPERVISOR, supervisorPassword]] as const) {
    const a = await setAnalyst(pool, { ...who, password }, "script:demo-analysts");
    console.log(`${a.email} (${a.role}) ready`);
  }
} finally {
  await pool.end();
}
