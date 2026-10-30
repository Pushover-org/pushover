import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(filePath: string, source: string): Promise<number> {
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages.filter((m) => m.ruleId === "no-restricted-imports").length ?? 0;
}

describe("import boundaries", () => {
  const agentFile = "packages/agent/src/probe.ts";
  const oracleFile = "packages/oracle/src/probe.ts";

  it.each([
    `import { PayPalClient } from "@pushover/paypal";`,
    `import { refund } from "@pushover/paypal/refunds";`,
    `import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";`,
    `import { PayPalClient } from "../../paypal/src/client.ts";`,
    `export { PayPalClient } from "@pushover/paypal";`,
  ])("packages/agent rejects %s", async (source) => {
    expect(await restrictedImportErrors(agentFile, source)).toBe(1);
  });

  it("packages/agent may import the ledger", async () => {
    expect(await restrictedImportErrors(agentFile, `import { handleRefundIntent } from "@pushover/ledger";`)).toBe(0);
  });

  it.each([
    `import { decide } from "@pushover/ledger";`,
    `import { decide } from "../../ledger/src/decide.ts";`,
  ])("packages/oracle rejects %s", async (source) => {
    expect(await restrictedImportErrors(oracleFile, source)).toBe(1);
  });

  it("other packages may import PayPal code", async () => {
    expect(
      await restrictedImportErrors("packages/ledger/src/probe.ts", `import { PayPalClient } from "@pushover/paypal";`),
    ).toBe(0);
  });
});
