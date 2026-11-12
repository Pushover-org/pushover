# AI assistance

## In the product

- **Claude Haiku 5.5** (Anthropic API) reads each receipt photo and returns findings in a fixed schema.
  It has no tool that decides a claim or moves money: twelve checks in code and a versioned decision
  table decide, and `packages/examiner` is forbidden by lint from importing PayPal code
  (`test/import-boundaries.test.ts`).
- **Claude Haiku 5.5** also writes the ring investigator's notes on a linked group. It recommends; a
  person decides.
- **Claude Sonnet 5.5** was run once on the same held-out claims as a comparison.
- **AG Studio** ("Ask the desk") answers questions about the claims grid. Its agent runs on Claude and is
  given read-only tools only (`apps/web/lib/studio-llm.ts`); it never decides, holds or pays a claim.
- Spend is capped in code (`CostGuard`): every run and the public demo have a hard dollar limit.

## In building it

This repository was written with AI coding assistance (Claude Code), directed and reviewed by the
owner. Commits carry no AI attribution lines; this file is the disclosure.

How the work was checked:

- **Tests.** 1,004 unit and database tests and 26 browser tests (Playwright), run in CI on every push.
  The eval runner, its independent oracle (which may not import the code it checks) and the decision
  table each have their own tests.
- **Every PayPal behaviour claim was run in the sandbox** before it was relied on, and recorded in
  [`docs/sandbox-findings.md`](docs/sandbox-findings.md) with the IDs PayPal returned.
- **PayPal's Server SDK** was wired using the APIMatic Context Plugin for PayPal's TypeScript guides,
  and each choice was checked against the SDK's own source (`docs/architecture.md`).
- **Pre-registration.** The claim sets, their labels and the pass mark were committed before any eval
  run; results that went against us are kept (`docs/methodology.md`).
- **Corpus labels.** The real receipts were transcribed in a Claude Code session, not by a person.
  Receipts whose numbers didn't add up were re-checked by eye (4 corrected). This is a limitation, listed
  in [`LIMITATIONS.md`](LIMITATIONS.md).
