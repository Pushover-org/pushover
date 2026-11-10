import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(filePath: string, source: string): Promise<number> {
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages.filter((m) => m.ruleId === "no-restricted-imports").length ?? 0;
}

describe("import boundaries", () => {
  const examinerFile = "packages/examiner/src/probe.ts";
  const oracleFile = "packages/eval/src/oracle/probe.ts";

  it.each([
    `import { PayPalClient } from "@proofofclaim/paypal";`,
    `import { createPayoutBatch } from "@proofofclaim/paypal/payouts";`,
    `import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";`,
    `import { PayPalClient } from "../../paypal/src/client.ts";`,
    `export { PayPalClient } from "@proofofclaim/paypal";`,
  ])("packages/examiner rejects %s", async (source) => {
    expect(await restrictedImportErrors(examinerFile, source)).toBe(1);
  });

  it("packages/examiner may import the claims types", async () => {
    expect(await restrictedImportErrors(examinerFile, `import type { Settlement } from "@proofofclaim/claims";`)).toBe(0);
  });

  it.each([
    `import { decide } from "@proofofclaim/claims";`,
    `import { decide } from "../../../claims/src/decision-v1.ts";`,
    `import { runChecks } from "@proofofclaim/checks";`,
    `import { allocate } from "@proofofclaim/distribute";`,
    `import { examine } from "@proofofclaim/examiner";`,
  ])("the eval oracle rejects %s", async (source) => {
    expect(await restrictedImportErrors(oracleFile, source)).toBe(1);
  });

  it("the rest of packages/eval may use the decision code (arm C runs it)", async () => {
    expect(await restrictedImportErrors("packages/eval/src/run.ts", `import { decide } from "@proofofclaim/claims";`)).toBe(0);
  });

  it("other packages may import PayPal code", async () => {
    expect(
      await restrictedImportErrors("packages/distribute/src/probe.ts", `import { PayPalClient } from "@proofofclaim/paypal";`),
    ).toBe(0);
  });

  describe("the assistants' code can file and read, never confirm, decide or pay (P12)", () => {
    const files = ["apps/web/lib/mcp/server.ts", "apps/web/app/api/mcp/route.ts", "apps/web/app/api/v1/claims/route.ts", "apps/web/lib/server/assistant-api.ts"];
    it.each(files.flatMap((f) => [
      [f, `import { confirmFiling } from "@proofofclaim/desk";`],
      [f, `import { reviewClaim, fileForPerson } from "@proofofclaim/desk";`],
      [f, `import { approveAndDistribute } from "@proofofclaim/desk";`],
      [f, `import { bindClaim } from "@proofofclaim/db";`],
      [f, `import { recordDecision } from "@proofofclaim/db";`],
      [f, `import { PayPalClient } from "@proofofclaim/paypal";`],
      [f, `import { allocate } from "@proofofclaim/distribute";`],
      [f, `import { sealIdentity } from "@/lib/server/paypal-login.ts";`],
      [f, `import { requireAnalyst } from "@/lib/server/auth.ts";`],
      [f, `import { confirmFiling } from "../../../packages/desk/src/assistants.ts";`],
    ]))("%s rejects %s", async (file, source) => {
      expect(await restrictedImportErrors(file, source)).toBe(1);
    });

    it.each(files)("%s may file and read", async (file) => {
      expect(await restrictedImportErrors(file, `import { fileForPerson, claimByStatusToken, ClaimRejectedError } from "@proofofclaim/desk";`)).toBe(0);
      expect(await restrictedImportErrors(file, `import { PgRateLimiter, assistantFilingsSince } from "@proofofclaim/db";`)).toBe(0);
    });

    it("the real files pass the boundary", async () => {
      const results = await eslint.lintFiles(["apps/web/lib/mcp/**/*.ts", "apps/web/app/api/mcp/**/*.ts", "apps/web/app/api/v1/**/*.ts", "apps/web/lib/server/assistant-api.ts", "apps/web/lib/api/**/*.ts"]);
      expect(results.length).toBeGreaterThanOrEqual(6);
      expect(results.flatMap((r) => r.messages.filter((m) => m.ruleId === "no-restricted-imports"))).toEqual([]);
    });
  });
});
