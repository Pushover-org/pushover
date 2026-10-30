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
    files: ["**/test/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  // The model never moves money (spec §0.1 rule 7, §2.7). The agent package must not
  // reach PayPal directly: no @pushover/paypal, no @paypal/* SDKs, no relative path into it.
  {
    files: ["packages/agent/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@paypal/|(^|/)paypal(/|$)",
              message: "packages/agent must not import PayPal code. Refunds go through request_refund and the ledger.",
            },
          ],
        },
      ],
    },
  },
  // The oracle scores the ledger, so it must not share code with it (spec §5.6.3).
  {
    files: ["packages/oracle/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)ledger(/|$)",
              message: "packages/oracle must stay independent of packages/ledger (spec §5.6.3).",
            },
          ],
        },
      ],
    },
  },
);
