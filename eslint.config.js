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
);
