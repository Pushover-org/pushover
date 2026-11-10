# rings-v2: a fresh held-out set for ring detection v2

Pre-registered 2026-11-10, committed before any measurement on it. Built by
`node packages/eval/scripts/build-rings-v1.ts 20261111 rings-v2` (seed 20261111, never used before;
the same recipe as rings-v1, with the network fix below). Synthetic throughout, like rings-v1
(`../rings-v1/README.md` describes the kinds of claimant).

1,536 claimants in rings (device_farm 404, template_crew 397, inbox_ring 196, address_mill 304,
quiet_ring 235) and 3,464 honest (household 704, campus 240, shared_network 150, coincidence 50,
solo 2,320). Manifest SHA-256 `a164b34991115e8b411fdf9b9063115839353e905b0fe37b57fa034bc72b5999`.

## Why there is a v2

rings-v1's pre-registered measurement (`../../results/rings-v1-2026-11-10/summary.json`) held 38.7%
of honest claimants, far above what we expected. Two causes, diagnosed on rings-v1 and then on a
development set (`rings-dev`, seed 7771, not committed; rebuild it with the command and seed):

1. **The detector chained story links.** Near-identical declarations linked pairwise, and a chain of
   single links joined strangers who share nothing (one group of 249). Fixed in the detector:
   `storyMinDegree: 2`, a story link is strong only inside the story graph's 2-core.
2. **The generator collided networks.** Its IPv4 test networks were numbered inside one range, so 256
   "different" networks shared each /24 prefix, the prefix the network signal keys. Fixed in the
   generator (one /24 per network); rings-v1 is still rebuilt exactly with `legacy-networks`.

On rings-dev the v2 rule held 5.8% of honest claimants (households 24.6%) with 82.2% recall. That
was the last tuning. Nothing about the detector or the metrics changes before rings-v2 is measured.

## Frozen for this measurement

- Detector: `findRings` with `RING_CONFIG` (story shingle 3, Jaccard 0.5, storyMinDegree 2,
  attachMinMembers 2), `packages/checks/src/rings.ts` as committed with this README.
- Metrics: as in rings-v1: recall by fraud kind, false holds by honest kind with Wilson 95% intervals,
  group purity. Run: `node packages/eval/scripts/eval-rings-v1.ts rings-v2 v2`.

## Expected (from rings-dev)

device_farm, template_crew, inbox_ring and quiet_ring near 100% recall; address_mill near 0% (the
known blind spot: only weak signals); households held where two members share a family device (about
a quarter); campus, shared_network and solo near 0%; coincidence pairs partly held.
