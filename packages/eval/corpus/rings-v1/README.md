# rings-v1: 5,000 synthetic claimants for measuring fraud-ring detection

Pre-registered 2026-11-10, committed before any measurement on it (plan items P31, P32, C8).
Built by `node packages/eval/scripts/build-rings-v1.ts` (seed 20261110; deterministic: the same
manifest every run). **Everything here is synthetic**: fictional people, `example`-style data, no
receipts (receipt fraud is measured on claims-v1). It measures one thing: which claims ring
detection (`findRings`, `packages/checks/src/rings.ts`) puts into groups held for a person.

## What's in it (`manifest.jsonl`, one claimant per line, with its label)

| Kind | Truth | Claims | How it's built |
|---|---|---|---|
| device_farm | fraud | 361 | 40 rings of 5–15: one device, different names, inboxes, homes, words; filed within 3 hours |
| template_crew | fraud | 501 | 30 rings of 5–25: one of 3 templates with a word or two changed; everything else different |
| inbox_ring | fraud | 229 | 40 rings of 3–8: one Gmail inbox under different names, by dots, plus-tags and capitals |
| address_mill | fraud | 308 | 30 rings of 5–15: one building (different units), mostly one network; own devices, inboxes, words |
| quiet_ring | fraud | 229 | 40 rings of 4–8: one device shared by two members, one network for all |
| household | honest | 658 | 200 homes of 2–5: one building and router, own inboxes and words; in a quarter, two members file from one family device |
| campus | honest | 240 | 6 dorms of 40: one building, one campus network, own devices |
| shared_network | honest | 150 | 5 cafés of 30 strangers on one network |
| coincidence | honest | 50 | 25 pairs of strangers who wrote almost the same short sentence |
| solo | honest | 2,274 | everyone else: nothing shared |

1,628 fraud (32.6%) and 3,372 honest. Two different people never share an inbox (enforced by the
generator). Fields: `id, kind, ring, truth, name, email, address_line, zip, state, ip, device_id,
declaration, filed_at`.

## What will be measured (`packages/eval/scripts/eval-rings-v1.ts`)

Signals are computed as the app computes them: keyed hashes of the device ID, the normalised inbox
and the building, the network prefix as C9 keys it, and the declaration. Then `findRings` with
`RING_CONFIG` (story: 3-word shingles, Jaccard ≥ 0.5; weak links attach only through ≥ 2 core
members).

1. **Recall by fraud kind**: the share of that kind's claims that end up in any group.
2. **False holds by honest kind (C8)**: the share of honest claims that end up in any group, overall
   and by kind, with Wilson 95% intervals. A held claim isn't denied, but it waits for a person.
3. **Group purity**: of the groups found, how many contain an honest claimant; of the grouped claims,
   how many are fraud.

There is no pass/fail gate; the numbers are reported as measured.

## Expected before running (so the result can surprise us)

- device_farm, template_crew, inbox_ring, quiet_ring: mostly grouped (each has a strong link by
  construction; a quiet ring's other members share the network with both core members).
- address_mill: **not grouped**. It shares only weak signals (building, network), and a shared building
  alone never makes a group, by design, to protect households and dorms. This is a known blind spot.
- Households with a shared family device (about a quarter) **will be held** (a device is a strong
  link), so expect household false holds near 25% of the claimants in those homes. That's the case the
  investigator and a person exist to clear. Coincidence pairs will be held too.
- campus, shared_network, solo: no false holds.
