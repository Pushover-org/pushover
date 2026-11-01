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
    `import { PayPalClient } from "@pushover/paypal";`,
    `import { createPayoutBatch } from "@pushover/paypal/payouts";`,
    `import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";`,
    `import { PayPalClient } from "../../paypal/src/client.ts";`,
    `export { PayPalClient } from "@pushover/paypal";`,
  ])("packages/examiner rejects %s", async (source) => {
    expect(await restrictedImportErrors(examinerFile, source)).toBe(1);
  });

  it("packages/examiner may import the claims types", async () => {
    expect(await restrictedImportErrors(examinerFile, `import type { Settlement } from "@pushover/claims";`)).toBe(0);
  });

  it.each([
    `import { decide } from "@pushover/claims";`,
    `import { decide } from "../../../claims/src/decision-v1.ts";`,
    `import { runChecks } from "@pushover/checks";`,
    `import { allocate } from "@pushover/distribute";`,
    `import { examine } from "@pushover/examiner";`,
  ])("the eval oracle rejects %s", async (source) => {
    expect(await restrictedImportErrors(oracleFile, source)).toBe(1);
  });

  it("the rest of packages/eval may use the decision code (arm C runs it)", async () => {
    expect(await restrictedImportErrors("packages/eval/src/run.ts", `import { decide } from "@pushover/claims";`)).toBe(0);
  });

  it("other packages may import PayPal code", async () => {
    expect(
      await restrictedImportErrors("packages/distribute/src/probe.ts", `import { PayPalClient } from "@pushover/paypal";`),
    ).toBe(0);
  });
});
