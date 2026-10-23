# More pages: handoff

**Status:** decided, ready to build. Live feeds is not part of this set; keep `ChatIndexPage.tsx` as it is.
**Designs:** `docs/designs/more-pages/*.dc.html` (Claude Design artboards; `support.js` renders them).
**Style:** matches the compact pages (#87) on phones and Create competition (#95) on laptops. Don't restyle Timetable, Toplist, Details, Entries, Sign in, Sign up, Profile, Create competition, Scoring or Test payment.

## Phone pages

| Artboard | Replaces | Notes |
|---|---|---|
| `Main.dc.html` | `CompetitionPicker` (`/`, `/competitions`) | Search, Upcoming/Past switch, **On today** card with **Open competition**, then a dated list. Tags: Entries open, Closes {day}, Demo event. |
| `Following.dc.html` | `FollowingPage.tsx` (`/following`) | One block per event, one row per starred team with its next heat time. Late heats in amber with the delay. |
| `FollowingEvent.dc.html` | `FollowingTab.tsx` | **Following N teams** drop-down instead of chips: each team with next heat and Unfollow, then **Add teams**. No sideways scrolling. Next heats and latest results as compact rows. |
| `Dashboard.dc.html` | `DashboardPage.tsx` | Live event band with **Open**, four text tiles that show a live fact (no icon tiles), Needs you, your teams today, shortcuts. |
| `MyTeams.dc.html` | `MyTeamsPage.tsx` | First team expanded: next up, parent join code with **Copy** / **Change**, heat alerts switch (**60 minutes** before each heat). Notes removed. |
| `MySignups.dc.html` | `MySignupsPage.tsx` | Coming up / Past. Awaiting payment row gets **How to pay** and **Cancel entry**. |
| `Shop.dc.html` | `ShopPage.tsx` | Tack and kit / Event shops switch, search, listing rows, **Sell something** button. Pairs with BUG-26 (one shop). |
| `EventShop.dc.html` | `EventShopPage.tsx` | Items grouped, quantity steppers, total bar with **Review order**. |

Global pages use a 4-tab bar: **Events, Following, Live, Me**. Competition pages keep Timetable, Toplists, Live & stream, Details, Me.

## Laptop pages (880px column, Create competition styling)

| Artboard | Replaces | Notes |
|---|---|---|
| `Admin.dc.html` | `AdminPage.tsx` | Competitions list (stage chip, entries, one action plus a ••• menu for lock signups, delete), **Waiting for you** approvals, blocked addresses. |
| `Format.dc.html` | `FormatPage.tsx` step 3 | Per age group: **Standard / HHF** (`usesRaceFinals`), run-off race, teams in finals, **minutes per heat**. Sessions table (session, arena, race list) with **Add a session**; start times come from Generate. Breaks and briefings list. Footer: **Preview timetable**, **Generate timetable**. Covers the step 3 gap in BUG-27. |
| `Rules.dc.html` | `RulesPage.tsx` | Search and category, race list, selected race edits inline: name, category, one-line summary, rules, diagram. |

## Open

- Minutes per heat is per session today (`Session.minutesPerHeat`). Either copy the age group's value onto its sessions or add it to the section.
- Format and Timetable management can both edit sessions. Pick one owner.
- Live feeds: not redesigned.
