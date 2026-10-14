# Speed and unreliable connections

The first screen now imports three page modules directly, down from 21. The other 18 load when opened. This is a source-level count, not a measured reduction in transferred bytes or loading time. A production build passed on 14 October 2026. The main JavaScript bundle is 380.88 kB (120.69 kB gzip), and the service-worker precache lists 56 entries totalling 776.59 KiB. There is no comparable baseline build or throttled phone measurement yet.

The footer has been removed.

## Changes in this session

- Public competition lists, timetables and toplists can fall back to a saved response after three seconds without a network response. Saved copies are labelled in the UI. The cache holds up to 80 responses for up to 24 hours; it cannot provide a competition that has never been fetched successfully.
- Account endpoints, declaration forms, signups and writes are excluded from caching. The previous broad API cache is cleared when the new service worker activates.
- The cached app shell handles direct page links offline. Admin page chunks are excluded from precaching because they require a connection. Other app chunks are cached in the background, which uses data on the initial visit.
- Live connections retry failed starts, rejoin the competition after reconnecting and refresh the competition snapshot. The visible competition page also refreshes every 30 seconds while live updates are disconnected, provided the browser reports a connection.
- A failed refresh keeps the loaded timetable visible. A network failure while checking a saved login no longer signs the user out.
- GET requests stop waiting after 15 seconds. Score submissions also have a 15-second timeout, preserve pending placings and explain when the server has not confirmed a save. Writes are not queued or retried automatically: an interrupted response can mean the server saved the result but the phone did not receive confirmation.
- The compact timetable loads its larger team-search, export and management view only when opened. Weather requests share a 30-minute in-memory cache by venue, forecast hour and endpoint. The header uses the already-loaded venue and no longer downloads the competition again. Public timetable rows make no weather requests. Current weather refreshes only while visible and online; failures show unavailable weather instead of a made-up temperature.
- App updates use the existing confirmation prompt rather than replacing the running service worker immediately.

## Vercel migration

Start with the Vite frontend on Vercel and keep the existing .NET API and SQLite database on their current host. This is a recommendation for this application's current architecture, not a claim that Vercel cannot run backend code. Vercel now documents [container functions](https://vercel.com/docs/functions/runtimes/container) and [WebSocket support](https://vercel.com/docs/functions/websockets) in beta. Migrating the backend still needs a plan for persistent database storage, SignalR connections and shared state across instances.

Use `web` as the frontend root, its existing `npm run build` command and `dist` as the output directory. [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite) explains the SPA fallback needed for direct links. API and live-hub routes must be handled before that fallback. The current client and offline cache expect same-origin `/api` and `/hubs` paths; confirm HTTP and WebSocket routing to the backend in a preview before switching the domain. Keep private API responses out of shared CDN caches. No deployment or CI settings were changed in this session.

## Next work, in priority order

1. Measure cold and repeat visits on a phone using a production preview, Slow 3G and offline mode. Record initial JavaScript bytes, time to a usable timetable and the request count. Check a saved direct link after closing and reopening the browser, not only after toggling offline on an already loaded page.
2. Reduce timetable payloads. The current competition response includes all teams, sessions, races and results. Consider a smaller public timetable response before adding more polling.
3. Test a score save with the response interrupted after the server receives it. Before adding an offline submission queue, add request IDs and server-side duplicate/conflict handling so reconnecting phones cannot overwrite another scorer's results silently.

Automated tests cover cache eligibility, saved-response labels, connection retry, competition rejoining, offline recovery, cleanup, timetable statuses, qualifier filtering, shared weather requests and cache expiry. The frontend production build now passes. Lint still fails; browser/PWA verification remains outstanding. Syntax-only and whitespace checks are available and are not a substitute for those checks.

The timetable follows the supplied HTML layout with day buttons, separate Heats and Finals groups, heat links, delay times and accessible status labels. Status dots use the supplied green, amber, blue and grey values; live dots pulse unless reduced motion is enabled. The Barlow font files could not be downloaded in this environment, so the CSS currently uses local fallbacks. A mobile visual comparison remains required.
