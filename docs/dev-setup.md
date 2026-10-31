# Developer setup (fresh machine)

Pushover is built by one person from two laptops, one at a time. Every commit is
authored as **laxmikhengare**. `docs/progress.md` says which step is next.

## What GitHub does not have

The owner hands these over directly, never through git, chat or email:

| File | Put it at | Notes |
|---|---|---|
| `CLAUDE.md` | repo root | The working rules for Claude sessions. Git-ignored on purpose. |
| `PUSHOVER-BUILD-SPEC.md` | the folder **above** the repo | The build spec. CLAUDE.md expects it at `../PUSHOVER-BUILD-SPEC.md`. |
| `.env.local` | repo root | Secrets: PayPal sandbox apps, Anthropic key, sandbox test card. **Send through a password manager or another encrypted channel.** |
| `captures-*.jsonl` | `.data/seed/` | The PayPal seed manifest. |
| `dev-db-data.sql` | anywhere | A snapshot of the dev database (which test orders are used or refunded). |

## 1. Tools

- Node.js 24 (`node -v`), Docker, git.
- pnpm 10 or later installed globally (`npm i -g pnpm`). Inside the repo it switches to the
  pinned pnpm 12.16.1 by itself (`packageManager` in `package.json`). Corepack is not needed.

## 2. GitHub access as laxmikhengare

1. Make an SSH key on this machine and add its public key to the **laxmikhengare** GitHub
   account (Settings → SSH and GPG keys).
2. If this machine also has other GitHub accounts, give the key an alias in `~/.ssh/config`:
   ```
   Host github-laxmi
     HostName github.com
     User git
     IdentityFile ~/.ssh/<that key>
     IdentitiesOnly yes
   ```
   Check it: `ssh -T git@github-laxmi` must answer "Hi laxmikhengare!".
3. Clone with that alias (not HTTPS, which would use whatever account is logged in):
   ```
   git clone git@github-laxmi:Pushover-org/pushover.git
   ```
4. Inside the clone, set the identity and turn on the repo's commit-msg hook:
   ```
   git config user.name laxmikhengare
   git config user.email 129103027+laxmikhengare@users.noreply.github.com
   git config core.hooksPath .githooks
   git var GIT_AUTHOR_IDENT      # must show laxmikhengare
   ```
   The hook refuses commit messages with `Co-Authored-By`, "Generated with", 🤖 or an
   Anthropic noreply address. CI checks the same thing on every push. Never use `--no-verify`.

## 3. Install and check

```
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
```

## 4. Local database

```
docker run -d --name pushover-pg --restart unless-stopped \
  -e POSTGRES_USER=pushover -e POSTGRES_PASSWORD=<random> -e POSTGRES_DB=pushover \
  -p 127.0.0.1:5433:5432 -v pushover-pg-data:/var/lib/postgresql/data postgres:17-alpine
```

Put `DATABASE_URL=postgres://pushover:<random>@127.0.0.1:5433/pushover` in `.env.local`
(replace the existing line; its value from another machine points at that machine).

```
pnpm db:migrate
docker exec -i pushover-pg psql -q -v ON_ERROR_STOP=1 -U pushover -d pushover < dev-db-data.sql
```

Use the snapshot rather than `pnpm db:seed`: the snapshot knows which seeded orders were
already used and refunded at PayPal, and the manifest does not. (`pnpm db:seed` is for a
brand-new seed made with `pnpm seed`.)

If Docker Desktop is also installed, check which engine you are talking to
(`docker context show`) and stay on one.

## 5. Prove it works

```
pnpm test            # all green; the db tests run against the container
pnpm day1:d1-2       # PayPal sandbox login + 404 parse, moves no money
```

## 6. Start the Claude session

Open a fresh Claude Code chat in the repo folder. CLAUDE.md tells it to read the spec and
`docs/progress.md` first. A first message that works:

> Read CLAUDE.md, then the spec's §0.1, §1 and §2, then docs/progress.md and
> docs/architecture.md. Verify the git identity shows laxmikhengare. Continue with the
> next §9 step from docs/progress.md, explaining each step in plain language.

## Ending a turn

Tests green with output shown, small commits, push (ask the owner first), and update
`docs/progress.md`: what is done with evidence, where work stopped, open decisions, next
action. The next session, on either laptop, starts from there.
