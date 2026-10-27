# Welsh and French (cy, fr) for the web client

Decision background: `docs/competitive-gaps.md` point 11 (22 Oct). Welsh and French for the internationals; a translation layer plus native-speaker review. This plan covers the first pass: public pages first.

## Scope

Translated (public, entrants, trainers, supporters):

- Shell: `AppShell`, `NavigationDrawer`, `BottomTabs`, `GlobalTabs`, `TopBarTicker`, connection and offline banners, the pop-ups and warnings kit (`ConfirmDialog`, `Sheet`/`BottomSheet`, `Notice`, `PageProblem`, `Toast`), the cookie notice, Not found, Unsubscribe, Confirm email.
- Start page, events picker, the public competition tabs (home, details, timetable and sessions, toplists, teams, team page, following, weather, announcements as shown to the public, stream viewer, rulebooks list chrome), the entry page and form, dec forms for trainers, Login, Sign up, My signups, My teams, Following, Settings (language picker), Account and Profile basics.
- A language entry in the menu drawer and a picker in Settings.

Left in English for now: organiser, operations, creator wizard, scoring, stream controls, commentary and admin pages; `SessionPage` (shared with scorers); club shop and payouts; the embed widget; print pages. Also always English: anything typed by people or sent by the server (competition, section and race names, rulebook text, chat, announcements, API error messages, emails) and codes such as HC, S, CF, Q. Legal pages (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding`) stay English with one translated line saying so.

## Key structure

`web/src/i18n/{en,cy,fr}/` each hold one file per area (`common`, `shell`, `auth`, `account`, `entries`, `competition`, `teams`) and an `index.ts` that merges them. Keys are `area.thing` (`shell.menu.settings`); the area file name is the key prefix. English is the source: `MessageKey` is derived from it, so a missing or misspelt key fails the type check. cy and fr are `Partial` per area, and anything missing falls back to English. Plural messages are `{ one, two, few, many, other }` objects picked with `Intl.PluralRules` (Welsh uses all six categories). Placeholders are `{name}`.

## How components get `t`

- `const t = useT()` in components; `useLanguage()` for `lang` and `locale`.
- `tr(key, values)` (reads the active language) for code outside React: helpers in `lib/`, `confirmDialog` (it renders in its own React root, so it has no context).
- Dates and numbers: replace the hard-coded `'en-GB'` with `activeLocale()` (or `locale` from `useLanguage()`) in the helpers the translated pages use. The default is still `en-GB`, so English output does not change. Time zones are left as they are today (the device's zone).
- `LanguageProvider` sits at the top of `App`. First visit follows the browser language and is not stored; an explicit pick is stored in `mg.lang`. It sets `<html lang>`.
- Strings that were byte-identical in English move into `en/*.ts` unchanged.

## Risks and checks

1. Existing tests read English. The default with no provider is English, and jsdom's `navigator.language` is `en-US`, which maps to `en`. Check: the existing suite passes unchanged.
2. French and Welsh run longer. Check: look at the main screens at 390px wide in each language (buttons, bottom tabs, chips); shorten the translation first and change layout only if that fails.
3. A missing key must never show as a raw key. `translate` falls back to English, then to an empty string. Checks: unit tests, and the parity test fails on any untranslated key.
4. Placeholder mismatches (`{name}`). Check: the catalogue test compares placeholders between languages, allowing a plural form to drop `{count}` when another form keeps it.
5. Coverage gate (97% on `lib`, `components`, and so on). The i18n files sit outside the measured folders, but `components` and `lib` changes are covered by their existing tests plus new ones. Check: `npm run test:coverage`.
6. Bundle size and lazy loading. All three catalogues are bundled (small text). Check: compare `npm run build` output before and after; the result is in the PR description.

## Review

cy and fr are machine-drafted. `web/src/i18n/REVIEW.md` lists what needs a native speaker and the terms we were least sure of.

## Outcome (first pass)

- Also left in English: `SessionPage` and the heat picker and between-heats screens (scorer-facing), the team breakdown headings built in `lib/toplist.ts` (shared with the embed and TV kiosk), the on-video graphics, viewer connection messages from `live/streamViewer.ts`, the club shop and payouts pages, the flag picker's country names and the embed widget.
- Consent wording (terms tick box, email opt-in) stays English because the English text is what is stored with each consent; Welsh and French show a reading beside it.
- Bundle: all three catalogues sit in one shared `translate` chunk of 215 kB (57 kB gzip). The main `index` chunk went from 360.5 kB to 364.8 kB (gzip 107.91 to 107.94 kB). Loading Welsh and French on demand would take about two thirds of that off English visitors' first load; see the PR for the trade-off.
- Checked at 390px wide in Chromium for the home, toplists, teams, team page, details, following, weather, entry, rulebooks, settings, login, sign-up and menu screens in both languages: no page scrolls sideways and no button, tab or chip is clipped.
