# Design decisions

This is the house style for MG App's redesigned pages: every look, control and copy rule the owner picked while reviewing the organiser, site admin and "On the day" pages (25–26 October 2026) and the public pages (27 October 2026). Use it for any new or changed page so the whole app matches.

The source of truth for the organiser pages is the Claude Design canvas "MG App organiser pages" (https://claude.ai/artifact/6qhbrgghBuGs3kTVdVb6ci, private to the owner). It has three working prototypes: Create competition (desktop), Set up and site admin, and On the day (phone). When this file and the canvas disagree, the canvas wins; when the canvas and the code disagree, ask.

## How to approach a page

- Start from the live page. Screenshot it at phone width first and change the page body only. The owner likes the current app; whole new visual directions were rejected three times.
- Phone first. The exception is Create competition, which is desktop first but must still work on a phone.
- Offer small before/after changes, not A/B/C restyles.
- Leave animations alone. Another agent owns all motion (Framer Motion and CSS). Don't add, change or remove any unless the owner asks. The page transitions picked on 27 October are listed under Public pages, round 2.
- "Less AI":
  - no icon grid for every fact, no progress bars for their own sake;
  - no shouting labels;
  - no filler sentences;
  - no developer words.

## Before you open a UI pull request

Some organiser and site admin pages shipped without following this file (found 27 October 2026; being fixed on 28 October). Every PR that changes what a page looks like goes through this list. Copy it into the PR body and tick it.

1. **Read first:** this file, plus the canvas or handoff for the page (`docs/designs/*-handoff.md`). If they disagree with each other or with the code, ask the owner. Don't pick one yourself.
2. **Screenshot before and after** at phone width (390×844), and at 1440×900 for desktop-first pages (the creator). Put both in the PR.
3. **Chrome untouched:** top bar, notice line, "running late" line and bottom tabs are as built.
4. **Controls match this file:**
   - dropdown rows, not pill rows;
   - steppers for numbers, switches for on/off;
   - the T2 date row;
   - drag grips with no arrows;
   - destructive actions as red underlined text;
   - "+ Add …" as a grey bar;
   - one filled navy pill for the main action.
5. **Saving:** autosave, no Save button (scoring's "Save scores" is the only exception). Limits warn and never block.
6. **Copy:** UK English, put through `humanise`, no developer words, no filler sentences, nothing from the Rejected list below.
7. **Motion:** none added, changed or removed unless the owner asked for it on this page (see Page transitions below).
8. **Tokens:** colours come from the `--mg-*` tokens and the #194 button tokens in `web/src/theme/skin.css`. No hex values in components, and all five themes still read correctly.
9. **Scope:** change only the page body you were asked about. Note anything else you spotted in the PR instead of fixing it there.

## Look

- **Colours:** navy `#17385F` is the brand colour. Red `#E12A39` is only for LIVE/ON AIR, unread counts and destructive actions. The page background is light grey (`#F7F7F7`); cards and lists are white with `#DADADA` borders.
- **Type:** Barlow for text, Barlow Condensed for titles and big numbers.
- **Cards look** is the default: white rounded cards (radius about 12px) on the grey page, rows inside separated by a thin rule.
- **Full width** is used where the live site already does it: the event's Details tab and the organiser tools under it (tack check, passport check, print sheets, results book). Lists run edge to edge with no line above or below the list; the lines between rows stay. People and QR codes keeps the cards look.
- **Headings:**
  - Small section headings have no line under them.
  - In Set up and the creator, a full-width navy bar separates age groups/sections and sits under the page title on desktop.
  - Keep a modest gap above headings; the tool pages use tighter spacing (about 12px).
- **Rows** are even, with the same padding top and bottom. Give forms room to breathe (When and where needed extra padding).
- **Hatbands** show as a plain 10px solid bar down the left of a lane or team card. A white hatband gets a thin grey inner edge. No gradients and no tapering shapes; that was tried and rejected.

## Buttons and actions

- **Main action:** a filled navy pill (Next, Create competition, Make QR code, Go live).
- **Other actions in a row:** outlined pills.
- **Red actions:** anything destructive (Remove, Delete, Revoke, Block, End stream, Unpin, Cancel clip, Stop sending) is red underlined text, never a pill.
- **Add actions:** "+ Add …" is a full-width grey bar (`#E9EDF2`, navy text, plus icon), e.g. "+ Add a section", "+ Add a race", "+ Add a camera phone".
- **Header actions:** a page-level action that belongs to the whole page sits on the right of the sub-page header, inline with the title (Block in a message thread, End stream in Stream controls).
- **Send:** a round navy button with an arrow, inside or beside the text box, faded until there's something to send.
- **More options:** use a ⋯ menu instead of an ✕ when there is more than one choice, e.g. a hatband's ⋯ gives Change colour / Remove.
- **Keep it short:** avoid lots of pills; the owner finds rows of pills annoying. Prefer one dropdown, stepper or switch.

## Controls

- **Dropdown (D):** a settings row with the label on the left and the current choice plus › on the right. It opens a bottom sheet on phones and a small floating list on desktop.
- **Stepper (S3):** small round − and + with the number centred between them. Use it for counts and prices (price £0–500, max entries 1–60, zoom).
- **Switch (W2):** label on the left, small switch on the right. Use switches, not tick boxes, for on/off settings.
- **Date and time (T2):** a settings row ("Starts · Sat 24 Apr 2027, 09:00 ›") that opens a month calendar (event days ringed red) with a plain time box (the phone's own picker) and Done. Closing without Done keeps the old value. No preset time chips.
- **Reordering:** drag by a six-dot grip only, with no up/down arrows. ArrowUp/ArrowDown on the focused grip for keyboard users.
- **Tabs:** a segmented row of tabs under the header (e.g. Overlay · Auto · Replay · Camera).
- **Search:** a round search bar with a magnifying glass and no label above it.
- **Choice tiles:** for "one of these is on screen" choices (stream overlays), use half-width tiles in two columns. Tap the tile to choose it; the chosen one turns navy. A chevron on the tile opens its settings. No Show buttons, no radio dots, no hint text under each.

## Saving and copy

- Autosave everywhere; no Save buttons (scoring keeps "Save scores" because it publishes results).
- Limits flag but never block.
- UK English. Short, plain words. Say what happened: "Received", not "Returned"; "Running 6 minutes late".
- Cut any sentence that says nothing new (the owner's example: "Scored in its own table. Standings stay the same").
- Copy people read goes through the `humanise` skill.
- Section names: team sections are named by age only ("Under 12"); others put age first, then type ("Under 15 Pairs", "Under 8 Individual").
- Dec forms: always say "Dec form questions".

## Navigation

- **One menu everywhere:**
  - Organiser (Preparations, On the day tools, Site admin) comes first, then the event's own pages, then the Mounted Games pages.
  - Desktop has a sidebar.
  - On phone the page title sits in the navy bar with a back arrow.
- **MG logo:** opens the site admin dashboard, on site admin pages only.
- **Event app chrome:** keep the event app's top bar, notice line, "Main Arena running X behind" line and bottom tabs exactly as built. The only chrome change ever agreed is a squircle menu button.
- **Footers:** no Back/Next footers except in the creator wizard, where Back / "Step N of 10" / Next sit in a bottom bar.

## Areas and pages

### Set up (before the day)

- Preparations is a "Before the day" to-do list.
- Entries and dec forms are one page, grouped by section, with Paid/Not paid on each row. There is no Form teams, CSV import or Call button, and nothing opens by itself.
- Dec forms:
  - one page with three always-asked names (rider, pony, trainer);
  - "+ Add a question" offers common questions, with "Write your own…" last;
  - flag rules join conditions with "and";
  - forms can be per section.
- Event details uses the cards look, with Yellow/Red cards switches and a per-section tack scoring table.
- Sections: a standard section's final is added from its race lists ("Add a final" / "Remove the final"). "Carry points into the final" and "Double points in the final" only show once a final exists. There is never ×2 on single races.

### Create competition (desktop wizard)

- **Steps:** Start (from scratch / copy a past competition), About, When and where, Arenas, Sections, Structure and timing, Races, Dec form, Payment and rules, Review, then an optional Timetable.
- **About:** the icon picker lists every country's flag with a search box.
- **Sections:** steppers for price and max entries. Hatband rows have a ⋯ menu and can be reordered. A/B/C finals: number of finals = ceil(entries ÷ lanes), at most 3, and each final can have its own races.
- **Races:** a tab per session, drag to reorder, "+ Add a race", and "Use a preset list" / "Leave for later".
- **Review:** each part has an Edit pill; sections show their race chips.

### On the day (the normal event app with organiser controls in place)

- **Timetable and toplists:** identical to the live site. The timetable rows have slightly less padding.
- **Scoring:**
  - **Layout:** the whole screen, with a full-width heat picker bar under the header and race ‹ › arrows. Bordered lane cards show the hatband bar.
  - **Tap to place, hold to eliminate:** tap places a team; press and hold eliminates. The red starts after 250 ms and the team is eliminated at 600 ms.
  - **Controls:** a ⋯ race-tools menu sits left of undo and clear. Race tools list teams first, each with ⋯ (HC, Yellow, Red, Change points); a second yellow becomes red, and undo covers all of it.
  - **Saving:** "SAVE SCORES". Saved races are read-only with "Edit this race".
  - **Heats:** you can edit earlier heats and the other arena's heats; heats not started show a read-only table with a "Score this heat" override. Between heats there is a page listing lanes, teams and dec forms.
- **Stream controls:**
  - **Header:** End stream sits in the header.
  - **Tabs:** Overlay is the choice tiles (None, Automatic, Back soon first). Auto has the rules. Replay holds the editor, race recordings and saved replays. Camera has "+ Add a camera phone" as a bar.
  - **Recordings:** race recordings just play the whole video, with no editing. Editing (follow frame, keyframes, start/end, slow-mo, Play on air) is for saved replays and cuts from "Last 30 minutes".
  - **New clips:** an instant replay you've just made shows "Cancel clip".
- **Live stream page:** "Control the stream" and "Commentary desk" sit side by side. End stream isn't on this page.
- **Commentary desk:** overlays, instant replay with Cancel clip, the race list with each team's points as heat / toplist (e.g. "6 / 40"), and Up next. No heat scores table and no "Say this".
- **Announcements:**
  - **Pinned:** the pinned notice sits at the top with Unpin.
  - **Composer:** a big box with a round send arrow.
  - **Sent:** a list of sent announcements, each with a Pin pill; the pinned one isn't repeated there.
- **Messages:** WhatsApp style, as a chat list and one thread per person. Block sits in the thread header. Spectators can't message. Chat is swear-filtered on the server (first letter kept, the rest starred).
- **Organiser tools** under Details: tack check (Pass/Fail per team), passport check (search, tick boxes), print sheets, people and QR codes (QR codes first, then the competition team), and results book.

### Site admin

- **Dashboard:** Needs you / Competitions / Manage the site.
- **People and access:**
  - Users sign themselves up. Admins are invited by email (the link asks only for name and password) as Organiser or Site admin.
  - A master admin can lock either; site admins can lock organisers.
  - Trainer requests have Approve all.
  - Blocked accounts are blocked by account, with IPs blocked behind the scenes.
- **Email:** an ordinary text email with links on words, or a picture as the whole email, plus an editable footer. The preview looks like a real email (no banner). Sending asks "Are you sure?" with the full preview, then shows progress with Stop.

### Public pages, round 2 (27 October 2026)

The owner reviewed each public page as "live capture beside a tidier version" on the canvas "MG App public pages, round 2" (https://claude.ai/artifact/4BVqrMaCsSVRQonDWiw8su, private). The depth is a timetable-style tidy, not a new layout. Sign-in and account pages were out of scope.

- **Approved to build:**
  - timetable;
  - heat page;
  - live stream;
  - teams;
  - team page;
  - arena setup;
  - rules;
  - weather;
  - event shop;
  - competitions;
  - past competitions;
  - seasons;
  - team profiles;
  - menu;
  - settings.

  The build is on `demo/public-pages`, from `demo/event-pages` and `demo/site-pages`.
- **Ticker dock:** the ticker sits in a dock at the bottom of every event page (PR #215 brings it to the rest).
- **Back button:** a boxed 44px arrow matching the menu button (`.mg-nav-btn`) on every page that has a back button.
- **Page transitions** (picked by the owner, so they're an exception to "leave animations alone"):
  - opening a page and going back use a push;
  - switching tabs uses a quick 160ms crossfade, starting part-faded (never from a blank page);
  - bottom pop-ups (sheets, confirm boxes, the "Save quick access" card, organiser sheets) use the **quick slide** picked on 28 October 2026: straight up in about 280ms, straight down in about 200ms, no bounce. Any of them can be swiped down: it follows the finger, and letting go past a quarter of its height (or after a quick flick) closes it, otherwise it slides back. Reduced motion and Lite mode skip the movement. Spring and lift-and-fade were the other options.
- **Heat page:**
  - built as it is now, with bigger team names;
  - no "Lane N" line, no ‹ › arrows, no Official mark, nothing underlined;
  - the diagonal race names run full length, and "#" and "TEAM" sit on the baseline at the foot of them;
  - PTS is right-aligned;
  - to change heat, a heat-list button beside the ticker dock opens a bottom sheet of the day's heats grouped by age group, with the current heat ticked.
- **Teams, competitions, past competitions:** the tidier versions were liked as they stand. Competitions loses its search bar.
- **Arena setup:** the ring crew splits into Top, Middle and Start line.
- **Menu:** the age group picker is a white settings-style row ("Age group · Juniors ⌄"), not the navy band, which read as part of the top bar.
- **Finals times** (decided 28 October 2026): an age group's finals have their own start time, set by the organiser ahead of the day on Timetable and draw, where a finals row always offers a Start time. Once it is set, the public timetable shows the finals block at that time before the draw ("Finals start", "Teams decided by the heats", no count of finals). Finals with no time set stay off the public timetable.
- **Toplist:** age groups appear as a row of tabs (like the day tabs), scrolling sideways when there are more than three. It has Toplist and Scores only, with no Heats tab. Ties show as "3=" with a thick 6px left bar like the live run-off. The A Final cut-off is a red dashed line labelled "A Final cut-off". Teams below it show "N pts needed for the A Final". There's no "N behind" figure and no chevrons.

  The toplist is **not yet approved**: ask before building it.
- **Still to check with the owner:**
  - the details cards (Dec forms hidden);
  - team stats and profile stats;
  - the season table (no warning, one selector row, names without " U14");
  - rider stats;
  - tack and kit (full-width slider at the top, search filter);
  - Following / My teams (follow teams outside a competition);
  - the teams filter open;
  - the menu age dropdown open;
  - the site menu (bigger text, no language row).

## Rejected (don't bring back)

- **Visual directions:**
  - wholesale restyles of the live pages;
  - gradient or tapering hatband shapes;
  - block buttons and rows of pill choices where a dropdown would do;
  - Back/Next at the top of the wizard;
  - hand-drawn redraws of live pages on the canvas: edit a capture of the live page instead;
  - story cards inline on the toplist or team page: a story image is one choice in the Share event sheet;
  - a heat page with Toplist/Timetable pills removed and ‹ › between heats.
- **Features:**
  - a race clock;
  - a timetable/finals tools page;
  - trainer notes;
  - a Clubs page;
  - preset time chips;
  - focus presets in the replay editor;
  - a lower third on the stream;
  - Off/Optional/Required on dec form questions;
  - ×2 on single races;
  - "N entered" lines.

## Process the owner uses

- The owner reviews one page at a time on the canvas and says merge, hold or what to change.
- Merged pages go to a build agent. One PR per page or a small bundle, reviewed, then merged when CI is green.
- Schema changes need an EF migration and a Neon step, so agents stop and ask before writing one.
- No force-pushes.
