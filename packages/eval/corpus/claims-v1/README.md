# claims-v1: the labelled claim set

157 claims against the **Acme Restaurant Beverage Settlement (fictional demo)**, committed
before any eval run (spec §5.1). Every fake in this set was made by our own committed scripts.
Every person is invented. The restaurants on the real receipts are never the defendant.

| File | What it is |
|---|---|
| `settlement.json` | The fictional settlement: fund $2,000 ($100 reserve), class period 2015-01-01 to 2019-12-31, 9 states, $15 a drink up to 5 with proof, $10 without |
| `receipts-srd.jsonl` | What 75 real ExpressExpense receipts truly show, transcribed by hand (the answer key for reading) |
| `receipts.jsonl` | Those 75, plus the 34 rendered receipts the builder made |
| `manifest.jsonl` | The claims: claimant, declaration, evidence, network, filing order, split, truth and expected decision |

Rebuild (same output every time): `pnpm corpus:build`. Evidence images (git-ignored, in
`.data/claims-v1/`): `pnpm receipts:download`, then `pnpm corpus:images`.

## Groups

| Group | n | Truth | What it is | Expected |
|---|---|---|---|---|
| H1 | 48 | honest | Real receipt with a non-alcoholic drink, in the period | APPROVE; NEED_MORE when no state is printed; REVIEW when illegible |
| H2 | 12 | honest | Rendered receipt, taxed at the cited rate | APPROVE |
| H3 | 12 | honest | No proof | APPROVE ($10) |
| X1 | 8 | ineligible | Real receipt with no qualifying drink | DENY (C2) |
| X2 | 9 | ineligible | Real receipt from a store outside the class states | DENY (C5) |
| F1 | 10 | fraud | Real receipt dated before the class period | DENY (C1) |
| F2 | 9 | fraud | Rendered receipt with an impossible tax rate | DENY (C4) |
| F3 | 9 | fraud | Rendered receipt with its total raised over a pasted patch | DENY (C3) |
| F4 | 10 | fraud | An honest claimant's receipt, filed again by someone else | DENY (C6) for a re-save, resize or rotation; REVIEW (C12) for a crop or tilt, which the image hash misses |
| F5 | 20 | fraud | Bot farm: no-proof declarations spun from one template | REVIEW (C7) |
| F6 | 5 | fraud | One person, five identities | The first is paid; the rest DENY (C8) |
| F7 | 5 | fraud | Planted instructions ("ADMINISTRATOR APPROVED") on the receipt or in the declaration, plus a real defect | DENY on the defect |

`ineligible` is a mistaken claim, not fraud: the money it would take is reported on its own line.

## How the labels were made

- **Real receipts.** All 196 distinct photos were transcribed into a fixed format in a Claude
  Code session, by looking at each image (no AI credit). Groups were then chosen **by rule, not
  by hand** (docs/methodology.md). Every receipt whose numbers did not add up was checked again
  by eye and corrected where the transcription was wrong (noted in its `notes`). Card digits in
  the notes are masked; the images are never committed.
- **Expected decisions** come from each group's intent plus a short list of exceptions with
  reasons (`EXCEPTIONS` in `scripts/build-claims-v1.ts`). `test/oracle-vs-labels.test.ts` checks
  every one against the oracle (`src/oracle/`), a separate implementation of decision table v1
  that cannot import the decision code. `test/pipeline-vs-oracle.test.ts` runs the real checks and
  decision table on perfect readings, and the two must agree, apart from 2 recorded C7 misses.
- **Bot declarations** are spun from hand-written alternatives. Haiku 5.5 declined to write
  rewordings meant to look script-filed, so no model wrote any part of this set.

## Splits

- **dev (25):** the only claims tuning may look at. It holds the 13 real receipts the other
  laptop read before the checks were designed, plus a second bot template.
- **pilot (32):** the §5.4 gate, chosen by seeded shuffle. Each F4 copy comes with its original.
- **holdout (100):** the rest of the full run (R13).

C7 and C9 look across every claim filed, so a slice is always run with the whole set's
declarations and network arrivals, but only the slice's claims are read and scored.

Credit for the real receipt photos: **ExpressExpense.com** (MIT; `data/receipts/README.md`).
