# Neon database setup

The React frontend stays on Vercel. The .NET API connects to Neon using Entity Framework Core and Npgsql. Database credentials belong on the API server, never in browser code or `VITE_*` variables.

## Current setup

- Neon project: `wild-leaf-19597390`, organisation `org-hidden-silence-42555372`.
- The `production` branch has the PostgreSQL schema, including competition icons, and eight fictional demo events for reviewing the app.
- The Neon CLI is authenticated. Codex's global Neon MCP configuration uses OAuth and is restricted to this project. Start a new Codex session if its tools are not available in an existing session.
- `neon.ts` requests PostgreSQL only. The app keeps ASP.NET Identity for sign-in.
- The CLI writes connection variables into ignored local environment files. Do not commit or print their contents.

The deployment uses the eight Neon demo competitions. The owner confirmed that the old site's SQLite data does not need to be preserved; it has not been imported.

`web/vercel.json` forwards `/api` requests to the Render API and serves the app for direct page links. Live updates connect directly to Render using `VITE_LIVE_HUB_URL`; the Render blueprint allows the two production Vercel origins. Local development keeps the Vite proxy. The Render free service can still sleep when idle, so the first request may take around a minute; Neon persistence does not remove that hosting delay.

The demo events have separate sections, teams, timetables and results. Six were seeded for today or later and two are past events. The picker requests only IDs, names, dates and icons. Past events are requested when their page opens from the sidebar; competition details load after selection. Organisers can choose a flag or symbol under **Competition icon** when editing an event.

The explicit `npm run db:seed-review` command creates missing demo events without changing existing ones, except that it gives any of the eight events that has no event shop settings row the demo mark (so test payments work and the "Demo event" badge shows); a row the organiser already set is never touched. New events get £15.00 entry prices so the test payment page can be shown; existing events keep their prices, so set a price on a section to demonstrate it. It never runs during normal API startup. Dates are relative to the day the events are first created. Today's event is timed from the moment the command runs, so its running session is live now.

To refresh stale demo data, run `npm run db:reseed-review`. It deletes the eight seeder-named events ("Demo Meadow Cup" and so on) with everything under them, but only those that carry the demo mark; any other event, including one that merely shares a name, is left alone and reported. It then creates all eight again from the current time. Back up or branch the database first if you are unsure; the deletes run in one transaction.

## Run locally

Install dependencies in the repository root and in `web`, then build:

```sh
npm ci
npm ci --prefix web
npm run build
```

Pull the linked branch's variables if needed. Apply migrations with the direct connection, then start the API:

```sh
neon deploy
npm run db:migrate
npm start
```

In another terminal, start the frontend:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api` and `/hubs` to the API on port 5050.

`npm start` loads `.env` if it exists, otherwise `.env.local`. Set `NEON_ENV_FILE` to use a different file. The server uses pooled `DATABASE_URL` for requests and direct `DATABASE_URL_UNPOOLED` for migrations. TLS certificate verification is enabled. Missing PostgreSQL configuration fails at startup when `Database__Provider=postgres` is set.

PostgreSQL startup seeds the club list, race library and Identity roles. It does not create demo competitions or accounts. If `Admin__Key` is configured on the API server, startup creates a passwordless shared organiser account for the existing organiser sign-in. It does not change existing accounts. SQLite development keeps its existing demo behaviour.

## Verify changes

```sh
npm test
```

For the end-to-end database check, use an isolated branch named `setup-verification-…`. Pull its variables into an ignored file, migrate it, and run the check:

```sh
neon env pull --branch setup-verification-d0609171 --file .env.verification.local --services postgres
NEON_ENV_FILE=.env.verification.local npm run db:migrate
NEON_ENV_FILE=.env.verification.local npm run test:neon
```

The check starts the API on port 5051, signs in, creates a fake competition and timetable, checks UTC dates, restarts the API, checks persistence, updates the competition and removes the test records. It refuses to write to a branch without the verification prefix. The verification branch created during setup expires on 16 October 2026; create a new one after that date.

New migrations are generated from `AppDbContextFactory`, which needs no credentials. Review and test each migration on an isolated branch before applying it to production. The API checks for pending PostgreSQL migrations at startup and refuses to start until they are applied.

## Move the live API

For any future move with data to retain, take and verify a consistent backup before restarting or replacing its host. This deployment starts from the Neon demo data with the owner's explicit agreement.

After the data is ready, configure these variables on the **API host**:

- `DATABASE_URL`: pooled Neon connection.
- `DATABASE_URL_UNPOOLED`: direct connection on the machine running migrations; the API host only needs the pooled URL.
- `Database__Provider=postgres` and `Database__SeedDemoData=false`.
- Keep the existing `Jwt__Key` and `Admin__Key` values.

Deploy the updated API after its migration has been applied. In the Docker image, the migration command is `dotnet MountedGames.Api.dll --migrate-database`. The existing SQLite connection setting can then be removed. Recheck the public site's sign-in, competition picker, timetable and scoring before considering the switch complete.

For driver and connection guidance, see [Npgsql's EF Core documentation](https://www.npgsql.org/efcore/) and the [Neon PostgreSQL skill](https://github.com/neondatabase/agent-skills/tree/main/skills/neon-postgres).
