// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/", "**/.next/", "**/dist/", "**/coverage/", "playwright-report/", "test-results/"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/test/**", "**/sandbox/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  // The model never moves money and never decides a claim (Proof of Claim spec §0.1 rule 7).
  // The examiner reports findings only: no @proofofclaim/paypal, no @paypal/* SDKs, no relative
  // path into packages/paypal.
  {
    files: ["packages/examiner/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@paypal/|(^|/)paypal(/|$)",
              message: "packages/examiner must not import PayPal code. It reports findings; code decides and pays.",
            },
          ],
        },
      ],
    },
  },
  // The oracle checks the corpus labels against the rules as written, so it must not share
  // code with what it checks: the decision table, the checks, the allocation or the examiner
  // (spec §5.1).
  {
    files: ["packages/eval/src/oracle/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(claims|checks|distribute|examiner)(/|$)",
              message: "The eval oracle must stay independent of claims, checks, distribute and examiner (spec §5.1).",
            },
          ],
        },
      ],
    },
  },
  // Assistants can file and read, never confirm, decide or pay (plan item P12, spec rule 7). The MCP
  // server, its route, the JSON API and the service behind them may not import anything that does:
  // no PayPal code or PayPal login (which mints a claimant's identity), no analyst sign-in, no money
  // or deciding functions from the desk or the database.
  {
    files: ["apps/web/lib/mcp/**", "apps/web/app/api/mcp/**", "apps/web/app/api/v1/**", "apps/web/lib/server/assistant-api.ts", "apps/web/lib/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@proofofclaim/desk",
              importNames: [
                "confirmFiling", "disownFiling", "submitClaim", "claimantReturns", "decideClaim", "decideAfterClose", "reviewClaim", "recheckApproved",
                "planDistribution", "proposeDistribution", "approveAndDistribute", "cancelProposal", "readBack", "proposeCyPres", "approveCyPres",
                "decideGroup", "investigateGroup", "requestReoffer", "appealClaim", "sendDocument", "commitLedger", "workerTick", "login", "setAnalyst",
              ],
              message: "Assistants file and read; they never confirm, decide, review or pay (plan item P12).",
            },
            {
              name: "@proofofclaim/db",
              importNames: [
                "bindClaim", "lapseClaim", "moveClaim", "recordDecision", "recordAnalystDecision", "planBatch", "markBatchSent", "insertProposal", "decideProposal",
                "updatePaypalVerified", "setStatusTokenHash",
              ],
              message: "Assistants file and read; they never confirm, decide, review or pay (plan item P12).",
            },
          ],
          patterns: [
            {
              regex: "^@paypal/|(^|/)paypal(/|$)|paypal-login|(^|/)distribute(/|$)|(^|/)desk/src/|(^|/)server/(auth|money)(\\.ts)?$|(^|/)admin/",
              message: "Assistants file and read; they never confirm, decide, review or pay (plan item P12).",
            },
          ],
        },
      ],
    },
  },
);
