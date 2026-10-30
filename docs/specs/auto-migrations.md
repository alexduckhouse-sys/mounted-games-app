# Run Neon migrations automatically before the API deploys

Status: agreed 30 October 2026 (decisions at the end of this file), not built yet. Nothing is switched on before West Mids Pairs (31 October 2026).

## Why

On 30 October 2026, PR #344 (Stripe Step 1) and the Met Office / indoor change merged and deployed before their migrations reached Neon. On Postgres the API refuses to start while a migration is pending (`api/Services/DbInitializer.cs:21`), so every API request returned 500 for about two hours. Fixing it needed the production connection string, which neither Vercel (`vercel env pull` hands back `[SENSITIVE]` placeholders) nor Claude (the auto-mode classifier blocks pulling it) could supply. In the end it was typed into Neon's SQL Editor by hand.

The order is the whole problem. Today, merging to `main` starts two independent things:

- Vercel's Git integration builds and promotes the API (`vercel.json`, service `api`, `Dockerfile.vercel`) as soon as the push lands.
- Someone has to remember to run `npm run db:migrate` (`scripts/api.mjs --migrate` → `dotnet … --migrate-database` → EF `MigrateAsync` on `DATABASE_URL_UNPOOLED`, `api/Data/DatabaseConfiguration.cs:20`), or to paste `api/Data/Migrations/Scripts/*.sql` into Neon.

Nothing makes the second happen before the first.

## What we have to work with

- **CI:** `.github/workflows/ci.yml` runs `api` and `web` on every PR and on push to `main`. There's no deploy step; Vercel deploys from Git on its own.
- **Vercel env:** `DATABASE_URL` is set on the API project for **Production only** (checked 30 October, names only). Preview API deployments have no database, so a preview build can never touch production. `DATABASE_URL_UNPOOLED` isn't on Vercel at all, because the API host only needs the pooled URL (`docs/neon-setup.md`).
- **Migrations:** every migration has an idempotent script. EF runs each migration in its own transaction, and Postgres DDL is transactional, so a failed migration rolls back cleanly. 2 of the 51 scripts so far drop or rename something; the rest only add.
- **Repo:** it's public. GitHub never passes secrets to workflows triggered from forks, and environment secrets can be limited to the `main` branch.

## Options

### A. Migrate, then deploy, in GitHub Actions (recommended)

A new workflow, `deploy-api.yml`, runs on push to `main` when `api/**`, `Dockerfile.vercel` or `vercel.json` changes:

1. **`guard`** (no secrets). Lists the migration scripts this push added (`git diff --name-only <before> <after> -- api/Data/Migrations/Scripts`). If any contains `DROP COLUMN`, `DROP TABLE`, `RENAME`, `ALTER COLUMN … TYPE` or `SET NOT NULL`, it stops with a message saying this one is a manual, two-step change (see "Destructive migrations"). Also runs the API tests' migration build so a broken migration never reaches Neon.
2. **`migrate`** (`environment: production`, secret `NEON_DATABASE_URL_UNPOOLED`). `dotnet run --project api/MountedGames.Api.csproj -- --migrate-database`, with a throwaway `Jwt__Key` and `Admin__Key=` as `scripts/api.mjs` needs today. It's a no-op when nothing is pending. Prints which migrations it applied, never the connection string.
3. **Production promotion waits for `migrate`.** Two ways, to settle in the first build step:
   - **A1, preferred:** keep Vercel's Git deploys, and make production promotion wait for the `migrate` check, using Vercel's deployment checks (promote only after named GitHub checks pass). No extra secret. First confirm it's available for this project's container service on Pro.
   - **A2, fallback:** turn off Vercel's own production deploys for the API service (previews stay on), and have a `deploy` job run `vercel deploy --prod` after `migrate`. Needs a `VERCEL_TOKEN` scoped to the team in the same environment.

`concurrency: { group: prod-api, cancel-in-progress: false }` makes two quick merges run one after the other. The second run finds nothing pending, or applies its own migration, then deploys the newer commit.

### B. Block the merge until Neon has the migration (cheaper fallback)

A required PR check fails when the PR adds a migration that isn't in production's `__EFMigrationsHistory` yet. It reads production with a role that can only `SELECT` that one table (secret `NEON_READONLY_URL`). The person merging, or Claude with the owner's yes, still runs the script in Neon first, as we did for #339. Applying an additive migration before its code ships is safe, because old code ignores new columns and tables. This stops the forgetting, but not the manual step.

### Rejected

- **Migrate when the API starts.** Vercel starts several instances at once from zero, so several would race to migrate. The app's runtime login would need DDL rights. A failed migration becomes an outage instead of a failed job. It also reverses the settled rule that the API refuses to start with a pending migration.
- **Migrate in the Vercel build.** Builds run for previews and redeploys too, the build can't see Production-only secrets cleanly, and a build retried halfway is hard to reason about.
- **Apply migrations from the PR before merge, automatically.** A PR closed unmerged would leave its schema behind in production.

## Break this

- **A merge races the deploy:** A1 and A2 both hold production until `migrate` passes. The API already running keeps serving on the old code, which tolerates the extra columns.
- **A migration fails halfway:** that migration rolls back. Earlier migrations in the same push stay, and they're additive by the guard. No deploy happens, the old API keeps running, and the failed job emails the owner. Fix forward with a new PR.
- **Two merges close together:** handled by the concurrency group, which serialises them. The Neon side is idempotent.
- **A destructive change sneaks in:** the guard stops it, and `DbInitializer` stays as the last line of defence.
- **Secret leak:** the secret is limited to the `production` environment and the `main` branch, so fork PRs never see it. A workflow change that tried to print it would have to merge to `main` through a reviewed PR first, and GitHub masks secrets in logs. The role is the same owner role whose pooled URL Vercel already holds. For least privilege later, use a separate `migrator` role.
- **Neon is down or over its allowance:** `migrate` fails, nothing deploys, and the site stays on the last good version. That's better than today, where the API would deploy and then fail to start.
- **Event day:** don't switch this on during an event. First build it, then run it once with a no-op migration on a quiet day.
- **UK GDPR (Art. 32):** a production credential stored as an access-controlled, masked GitHub environment secret is an appropriate measure. No personal data moves.

## Destructive migrations

These stay manual, in two steps:

1. **Expand:** add the new shape, ship code that writes both.
2. **Contract:** drop the old shape in a later PR, after a backup branch or inside Neon's restore window, run by hand.

The guard's message links here.

## Backups

On a paid Neon plan, point-in-time restore covers a bad additive migration, so the workflow doesn't create a branch on every run. Creating one anyway is optional and would need `NEON_API_KEY`; Neon's branch limit is the reason not to.

## Docs to update when built

- `CLAUDE.md` and `api/CLAUDE.md`: "the script must run on Neon before the API deploys" becomes "merging runs it; destructive ones are manual".
- `docs/neon-setup.md`: the new flow, the secret, how to re-run a failed `migrate`.
- `docs/decisions.md`: record the choice.

## Owner decisions (30 October 2026)

1. **Option A, fully automatic.** Merging to `main` migrates Neon first, and the API goes live only once that has worked.
2. **The production unpooled connection string goes in a GitHub `production` environment secret, limited to `main`.** The owner adds it: Claude can't read production credentials.
3. **Destructive migrations stay manual and two-step.** The guard stops them.
4. **If Vercel can't hold promotion for the check (A1), use A2:** deploy from the workflow with a team-scoped Vercel token in the same environment.

## Build order

1. After the event: a branch with `deploy-api.yml` and the guard script. Test the guard against the 51 existing scripts; it must flag exactly the 2 destructive ones.
2. The owner creates the GitHub `production` environment (branch rule: `main`), and adds `NEON_DATABASE_URL_UNPOOLED` and, for A2, `VERCEL_TOKEN`.
3. Confirm A1 or A2, then switch the gate over in the same PR that makes the workflow required.
4. Prove it with one no-op merge on a quiet day, and watch the run, the deploy and `/api/competitions`.
