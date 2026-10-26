# Docs index

What each document is for and how far to trust it. When a doc and the code disagree, the code wins: fix the doc or flag it. Dates are the last substantive edit.

## Read first

| File | Use it for | State |
| --- | --- | --- |
| `../APP_DESIGN.md` | Goals, scope and agreed behaviour. Read before changing behaviour, and update it when a decision lands | Current (2026-10-17) |
| `../NEXT_STEPS.md` | The cross-chat to-do list. Update or remove items as they ship | Current; edited often |
| `competitive-gaps.md` | Competitor research and ranked gaps for selling the app; all points decided; built as one PR per stage | New (2026-10-22) |
| `decisions.md` | Settled decisions (trainer ownership, trainer approval, Cloudflare SFU video). Check before reopening a question, and add new ones here | Current |
| `../PRODUCT_DETAILS.md` | Competition lifecycle from entries to standings, by role | Mostly current (2026-10-16) |

## Reference

| File | Use it for | State |
| --- | --- | --- |
| `pc-mounted-games-race-rules-2026.md` | Pony Club race rules (text extracted from the official PDF, one very long line). Search it with `grep -o`; don't read it whole | Source material |
| `neon-setup.md` | Neon Postgres: local runs against a branch, `npm run db:migrate`, verification | Current. Its "Move the live API" section may be overtaken by hosting changes |
| `security-review.md` | Security review of 15 October: headers, rate limits, proxy IPs, remaining limits | Current for what it covers; not a pentest |
| `connection-performance.md` | Work done for slow or patchy venue connections, and what comes next | Partly done; check `NEXT_STEPS.md` |
| `test-coverage-handoff.md` | API and web test suite status, what isn't covered, suspected bugs found while testing | Current (2026-10-22) |

## Specs and designs

| File | Use it for |
| --- | --- |
| `specs/event-platform.md` | Agreed scope for seasons, event tools, shops and operations (16 October). Mostly shipped in PRs #33–#36 |
| `specs/live-stream.md` | Live video through the Cloudflare Realtime SFU: flows, API, limits. Shipped in #30 |
| `specs/stream-controls-backend.md` | The server work the Stream controls page still needs: auto rules, stored race recordings, viewer renderers. Proposal (26 October) |
| `designs/mobile-redesign-handoff.md` + `mobile-redesign-proposal.html` | Timetable, Live & stream, heat scores on phones. Shipped in #37 |
| `designs/event-platform-refinement-handoff.md` + `.html` | Visual rules (navy `#17385f`, red only for LIVE and destructive actions, Barlow fonts) and screens for shops, seasons and organiser pages |
| `designs/design-decisions.md` | The house style for redesigned pages: looks, controls, buttons, copy, navigation and per-page decisions the owner picked (25–26 October 2026). Start here for any new page, public or organiser |
| `designs/live-stream-proposal.html` | Static mock-ups of the streaming screens |

The `.html` files are self-contained previews; open them in a browser rather than reading the markup.

## Elsewhere

- `../CLAUDE.md` (also `AGENTS.md`): the repo-wide agent guide. `api/CLAUDE.md`, `web/CLAUDE.md` and `tests/CLAUDE.md` cover each area.
- `../README.md`: original setup notes from May 2026. Its EF migration and hosting details are out of date; prefer `CLAUDE.md`.
- `../DEPLOY.md`: Render and Fly walkthroughs from May 2026. Treat it as background; the live hosting setup is in `CLAUDE.md` and `NEXT_STEPS.md`.
- `../web/README.md`: the unchanged Vite template. Ignore it.
