# Architecture decisions

The full design is in the build spec (§4). This file records decisions made
while building, and why.

## Toolchain

- **pnpm 12.16.1**, pinned with `packageManager` in `package.json`.
  Corepack cannot launch pnpm 12 on Node 24.9 (it looks for `bin/pnpm.cjs`,
  which pnpm 12 no longer ships), and corepack 0.36 requires Node ≥ 24.15.
  A globally installed pnpm 10 reads `packageManager` and switches to
  12.16.1 by itself, so `pnpm` just works inside this repo. CI uses
  `pnpm/action-setup`, which reads the same field.
- **TypeScript 6.0.3**, not 7.x: `typescript-eslint` 8.72.1 declares peer
  `typescript >=4.8.4 <6.1.0`. Revisit when typescript-eslint supports 7.
- **Exact versions only** (no `^`). pnpm 12 refuses releases younger than its
  minimum release age; we pin an older release instead of adding exclusions.
- Packages are TypeScript source with `.ts` import extensions
  (`allowImportingTsExtensions`, `erasableSyntaxOnly`), run directly by
  Node 24's type stripping and by vitest. No build step for libraries.
  To verify in §9 step 10: Next.js resolves these workspace imports.

## Environment variables in a monorepo

There is one secrets file: `.env.local` at the repo root (git-ignored).
Nothing copies it.

- **Node scripts and packages** (day-1 scripts, seed, eval, worker): run with
  `node --env-file-if-exists=<repo root>/.env.local`. A missing file is
  tolerated, so the same command works on Railway, where variables come from
  the service settings.
- **Next.js (`apps/web`)** only reads env files from its own folder, so
  `apps/web/next.config.ts` calls `process.loadEnvFile()` on the root file
  when it exists.
- **Tests** that need credentials (`pnpm test:sandbox`) load the same file the
  same way and skip when the variables are absent.

## Import boundaries (ESLint `no-restricted-imports`, tested in `test/`)

- `packages/agent` may not import PayPal code. The model never moves money.
- `packages/oracle` may not import `packages/ledger`. The scorer stays
  independent of what it scores.
