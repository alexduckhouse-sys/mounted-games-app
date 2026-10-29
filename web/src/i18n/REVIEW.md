# Translation review notes

`cy/` (Welsh) and `fr/` (French) were drafted by an AI model. Neither has been checked by a native speaker, and neither should be treated as final before an event. English is the source in `en/`; anything missing from cy or fr shows in English.

## What a reviewer should check

- Register: friendly and plain, second person. Welsh uses the polite `chi` form. French uses `vous`.
- Welsh mutations and plurals. Counts use plural forms (`zero`, `one`, `two`, `few`, `many`, `other`) where the noun changes. Where it doesn't, the draft uses the singular noun after the number with no mutation (`3 ras`, `2 marchog`), which is the usual rule for counted nouns, but several strings were written this way without a check.
- Welsh ordinals: 1af to 20fed follow the standard table; above 20 the draft uses `ain`, which is a guess (`lib/ordinalText.ts`).
- Length. Button, tab and chip text was shortened where a literal translation was too long for a 390px screen; check nothing lost its meaning.
- Names (competitions, sections, races, clubs, riders), rulebook text, chat, announcements, server messages and emails are never translated: they show as the organiser typed them.
- Consent wording (terms tick box, email opt-in) stays in English because the English text is what is stored with each consent; Welsh and French show a reading beside it that says the English wording applies. Please check that lead-in carefully.
- Legal pages (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding`) stay English with one translated line saying so.

## Mounted Games vocabulary we were unsure of

The sport has no settled Welsh or French terms for several words. Where several drafts disagreed we picked one so the app is at least consistent. Please confirm or replace.

| English | Welsh (cy) | French (fr) | Notes |
| --- | --- | --- | --- |
| heat | rhagras | manche | Welsh has no settled word. `rhagras` (pre-race) was chosen over `gwres` (literal heat, wrong), `cymal` (stage) and `rhagbrawf` (qualifying round). Qualifying heats in the team breakdown are `rhagbrofion`. |
| final | rownd derfynol / terfynol | finale | |
| toplist | safleoedd (tab), tabl safleoedd | classement(s) | Matches "standings". |
| dec form | ffurflen ddatgan | formulaire de déclaration | Literal. The bottom tab is shortened to `Ffurflenni` / `Formulaires`. |
| enter / entry | cofrestru / cofrestriad | s'inscrire / inscription | |
| lane | lôn | couloir | |
| section / age group | grŵp oedran / adran | catégorie d'âge / catégorie | |
| hatband / bib | bib | dossard | |
| sit out | eistedd allan | au repos | |
| elimination | wedi’i eithrio | éliminé(e) | Status words also: did not start `heb ddechrau` / `non-partant(e)`, did not finish `heb orffen` / `n’a pas terminé`, retired `wedi rhoi’r gorau iddi` / `abandon`. The `(e)` forms avoid choosing a gender for a rider or a team. |
| carried forward | cario ymlaen | reporté | |
| run-off | ras ddatrys | barrage | |
| draw | tynnu enwau / balot | tirage au sort / tirage | |
| tack check / tack & turnout | archwilio tac / Tac a Chyflwyniad | contrôle du harnachement / Harnachement et tenue | |
| tack and kit shop | siop offer a chit | sellerie et équipement | |
| trainer | hyfforddwr | entraîneur | |
| team manager | rheolwr tîm | responsable d'équipe | |
| guest rider | marchog gwadd | cavalier invité | |
| solo rider | marchog unigol | cavalier seul | |
| reserve | wrth gefn | remplaçant | |
| pony / Pony Club | merlen / Clwb Merlod | poney / poney-club | |
| arena / collecting ring | arena / cylch casglu | arène / rond de rassemblement | |
| Hors Concours (HC) | kept | kept (lower case in French) | |
| following (starring a team) | dilyn / yn dilyn | suivis | "Rhowch seren" / "mettre en favori" for star. |
| live stream (tab) | ffrwd fyw | direct | |
| lite mode | modd ysgafn | mode léger | |
| notice badge / announcement | hysbysiad / cyhoeddiad | avis / annonce | |
| weights | stôn, pwysi | stones, livres | Kept in stone and pounds. |

Other specifics:

- French uses "né(e) : {value}" so it reads right for a year or a full date.
- The ring inside the heat ring (28px) holds `Byw` / `Nawr` (Welsh) and `Live` / `Maint.` (French); these are guesses and may not fit.
- Welsh and French weekday and month names come from the browser (`Intl`). A browser without Welsh data shows English day names; nothing breaks.
- Google, Apple and Facebook sign-in buttons use the provider's own wording. Google draws its button itself and is asked for `cy` or `fr`; if it has no Welsh it shows English. Apple's and Facebook's buttons are ours, so their text is in the catalogue: French uses `Se connecter avec Apple`, `Continuer avec Apple` and `Continuer avec Facebook`, which we believe are their official French titles (please check against Apple's Human Interface Guidelines and Facebook's brand guide). Welsh keeps the English (a deliberate fallback in `catalogues.test.ts`) because we couldn't find an official Welsh version from either. Apple's and Facebook's own pop-ups stay in English for now: their scripts are loaded from fixed `en_GB` addresses that the Content Security Policy names exactly, so changing the language there means changing the CSP too.
- "Ways to sign in" on My account: Welsh `Tynnu` and French `Retirer` for Remove (taking a sign-in off the account, not deleting anything). `Seul accès` for "Only way in" is short to fit beside the provider name.
- French `Connexion en tant que` for "Signed in as" avoids choosing `connecté` or `connectée`.

## How to review

Each area has one file per language in `cy/` and `fr/`: `common`, `shell`, `auth`, `account`, `entries`, `competition`, `teams`, plus (28 October 2026) `site` (public pages: stats, shop, volunteers, sponsors, contact, seasons, team profiles), `screen` (TV kiosk, prize-giving, stream overlays, embeds), `ops`, `ops2` and `ops3` (organiser pages, event tools, shop management), `admin` (site admin and the competition wizard) and `desk` (commentary desk, arena help and crew sheets, stream controls, broadcast). Keys are `area.thing`, and the English next to each is in `en/`. `catalogues.test.ts` checks that every English key has a Welsh and French entry and that `{placeholders}` match, so edits are safe to make directly.

## Review status (28 October 2026)

Every screen now goes through the catalogues, staff and admin ones included. Welsh and French load only when someone picks them (`translate.ts` `loadCatalogue`); English is always bundled and shows until the chosen language arrives.

An AI second pass (Gemini) checked placeholders (all match) and fixed clear mistranslations: Welsh `porthiant` (horse fodder) for a video feed, `baner` (national flag) for a warning flag, `dyrnau` (fists) for hands, `balot` (election ballot) for the draw, `wedi ymddeol` / `wedi'i ddileu` for retired and eliminated; French `Notation`, `aire de rassemblement`, "la 1er place", "Nom du équipe", "en tant que entraîneur". It is still not a native-speaker review.

Left for a native speaker, because the fix depends on judgement rather than a clear error:

- Welsh gender agreement around `rhagras` (`hon`, `fwyaf`, `bresennol`).
- Welsh wording in `match.title`, `plannedNow`, `events.mine`, `laneOrder`, the install-the-app text, the stabling words, `theirPhone`, `deadline.sent*`, `lookingPair`, `onNow` and `equineId`.
- French `volunteers.summary` / `taken` and `screen.ov.watching`.
- Strings built in shared helpers that are still English: tie-break reasons in `lib/toplist.ts`, the "+10 min" delay text, `hatbandName()` outside the stream overlay, `lib/commentatorFacts`, `lib/arenaCrewSheet`, and CSV file contents (deliberately English).

## Added by the design plan (28–29 October 2026)

The design-plan PRs wrote their own Welsh and French, as the owner asked, and none of it has had a second pass. These keys are new or changed since PR #302. To see the English, run `git diff 67b32b56^1 origin/main -- web/src/i18n/en`.

- **Things I sell** (`site.seller.*`, about 90 keys in `site`): the seller catalogue, item form, preset items (stabling, shavings, haylage, electric hook-up), stock, options and the archive and withdraw confirmations. Please check the stabling words and `site.seller.cat.camping` against the vocabulary table above.
- **Seasons** (`site.seasons.*` and `site.seasons.form.*`, about 60 keys): the season form, adding a round, points multipliers and the tie wording. `struck-through` became `crossed-out` in `site.seasons.caption` and `site.profiles.roundsIn`.
- **Stats** (`site.stats.*`, `teams.team.pointQuota`): "Point quota" was renamed to "Average points" (`Avg points`, `Avg pts`, `Per race`), and the sign-in lines went because stats are now public.
- **Sign-up and sign-in** (`auth.signup.role*Hint`, `auth.password.capsLock`): the hints under each "I am a" tick, and the caps lock warning.
- **Smaller ones:** `common.undo`, `account.supporters.loading` / `failed`, `site.shop.noEventShops`, `site.shop.contactPlaceholder`, `site.profiles.newProfile`, `teams.following.unfollowed`, `teams.rulebooks.add` / `addHint` / `addHintDock`.
- **Scoring (PR #312):** `desk.stream.bc.unlock` is now "Tap to unlock." (`Tapiwch i ddatgloi.` / `Touchez pour déverrouiller.`).

- **Accounts, club members and payouts (PR #315):** a new `acct` area (`acct.ts`, about 240 keys): club members (`acct.members.*`), seller payouts (`acct.payouts.*`), the demo payment flow (`acct.demo.*`), payment screens (`acct.pay.*`) and the team profile organiser forms (`acct.tp.*`). Please check `acct.demo.*` reads clearly as "no real money" in both languages.
- **Organiser operations (PR #316):** `ops3.plan.*` (about 50 keys, mostly scorer links in `ops3.plan.scorer.*`, plus the demo mark-paid labels, the equipment roll-back message, the rulebook search and the sections saved badge). Changed values: `ops.view.scorers` is now "People and QR codes", and `screen.qr.description` and `ops2.print.p.steps` point there.
- **Admin and the wizard (PR #314):** `admin.accounts.comps.search` / `searchPlaceholder` / `noMatch`, `admin.format.rules.createRace`, and the grip labels `admin.creator.hat.move` and `admin.format.dialog.move` (these replace the old move up / move down pairs). Changed values: `admin.creator.pay.testMode` (demo wording) and `admin.creator.sections.none` ("No limit").
- **Print (PR #317):** `ops2.print.p.postcode`.

- **Organiser tools in the dock and dock filters (PRs #310, #311):** the tools sheets (`ops.tt.toolsSheet`, `ops2.entries.toolsSheet`, `ops3.tc.settingsSheet`, `entries.tab.toolsTitle`, `entries.tab.exportTitle`), the dec-form QR and export lines (`entries.tab.showQr` / `qrLabel` / `qrScan` / `exportCsv` / `fillFor` / `formsClose`), `ops.tt.addBreakIn`, `competition.rules.raceRules`, the commentary and stream sheets (`desk.commentary.view` / `controls` / `pickWhat`, `desk.stream.pr.*` sheet lines), `screen.pg.setUpTitle` and `teams.stream.controls`.
- **Entries, timetable and money (PR #321):** `ops.tt.lockedNote`, `ops2.entries.outFold` ("Withdrawn or no-show"), `ops2.money.sending` and `ops2.money.statement`.
- **Stream controls (PR #323):** the phone tabs `desk.stream.tab.cameras` / `graphics` / `replays`, and `teams.stream.more` ("More options" on the player).
- **Public competition pages (PR #324):** the steward and horsebox cards (`competition.steward.*`, `competition.horsebox.heading`), the delay sheet (`competition.timetable.delay*`, `laneFor`), `competition.details.shop` / `ended`, `competition.toplist.finalResults`, `competition.scoring.savedStandings`, `teams.list.changeTrainer`, `teams.following.heatTotals` and the weather lines `teams.weather.noLocation` / `setLocation` / `organiserAction`. Changed values: `competition.scoring.savedStandings` and `desk.commentary.savedStandings` now say "toplist" rather than "standings" (English only; cy/fr unchanged). Please check the delay sheet wording, which organisers read under pressure.
