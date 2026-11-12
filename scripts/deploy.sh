#!/usr/bin/env bash
# The one way to deploy (docs/deploy.md): committed code only, the checks, the eval gate (plan
# item P52), then `railway up` for the web app and the worker. Any failing step stops the deploy.
#   scripts/deploy.sh            # both services
#   scripts/deploy.sh web        # one service
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "deploy: commit or stash your changes first; a deploy is of committed code" >&2
  exit 1
fi
echo "deploy: $(git log -1 --format='%h %s')"

pnpm lint
pnpm typecheck
pnpm test
node --env-file-if-exists=.env.local scripts/eval-gate.ts

for svc in "${@:-web worker}"; do
  for s in $svc; do
    echo "deploy: railway up --service $s"
    railway up --service "$s" --ci
  done
done
