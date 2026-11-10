// Creates an analyst account, or resets one's password and role. There is no web form for this.
// The password comes from the environment so it never lands in shell history or the process list:
//   NEW_ANALYST_PASSWORD='…' pnpm admin:add sam@example.com supervisor "Sam Ortiz"
// The judges' two sandbox logins are made the same way by `pnpm demo:analysts`.
import { createPool, type AnalystRole } from "@proofofclaim/db";
import { setAnalyst } from "../src/index.ts";

const [email, role, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim();
const password = process.env["NEW_ANALYST_PASSWORD"] ?? "";
if (!email || (role !== "analyst" && role !== "supervisor") || !name) {
  console.error('usage: NEW_ANALYST_PASSWORD=… pnpm admin:add <email> <analyst|supervisor> "<Full Name>"');
  process.exit(2);
}
const pool = createPool();
try {
  const a = await setAnalyst(pool, { email, name, role: role as AnalystRole, password }, "script:admin-add");
  console.log(`analyst ${a.id}: ${a.email} (${a.role}) ready`);
} finally {
  await pool.end();
}
