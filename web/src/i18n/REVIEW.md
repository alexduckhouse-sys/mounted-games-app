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
| elimination | wedi'i ddileu | éliminée | Status words also: did not start `heb ddechrau` / `non partante`, did not finish `heb orffen` / `abandon`, retired `wedi ymddeol`. Check `non classée` for DNF in French. |
| carried forward | cario ymlaen | reporté | |
| run-off | ras ddatrys | barrage | |
| draw | tynnu enwau / balot | tirage au sort / tirage | |
| tack check / tack & turnout | archwilio tac / Tac a Chyflwyniad | contrôle du harnachement / Harnachement et tenue | |
| tack and kit shop | siop offer a chit | sellerie et équipement | |
| trainer | hyfforddwr | entraîneur | |
| team manager | rheolwr tîm | responsable d'équipe | |
| line steward / changeover steward | stiward llinell / stiward trosglwyddo | commissaire de ligne / commissaire de relais | Heat duties wizard (`duties.*`). Role names an organiser types themselves are never translated. |
| arena party | parti arena | groupe d'arène | |
| collecting ring | cylch casglu | zone de rassemblement | |
| scorer | sgoriwr | marqueur | Also in the wizard's grid headings (`duties.col.*`), which are shortened to fit a phone. |
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

- French "né(e) en" is used even when the value is a full date.
- The ring inside the heat ring (28px) holds `Byw` / `Nawr` (Welsh) and `Live` / `Maint.` (French); these are guesses and may not fit.
- Welsh and French weekday and month names come from the browser (`Intl`). A browser without Welsh data shows English day names; nothing breaks.
- Google, Apple and Facebook sign-in buttons use the provider's own wording. Google draws its button itself and is asked for `cy` or `fr`; if it has no Welsh it shows English. Apple's and Facebook's buttons are ours, so their text is in the catalogue: French uses `Se connecter avec Apple`, `Continuer avec Apple` and `Continuer avec Facebook`, which we believe are their official French titles (please check against Apple's Human Interface Guidelines and Facebook's brand guide). Welsh keeps the English (a deliberate fallback in `catalogues.test.ts`) because we couldn't find an official Welsh version from either. Apple's and Facebook's own pop-ups stay in English for now: their scripts are loaded from fixed `en_GB` addresses that the Content Security Policy names exactly, so changing the language there means changing the CSP too.
- "Ways to sign in" on My account: Welsh `Tynnu` and French `Retirer` for Remove (taking a sign-in off the account, not deleting anything). `Seul accès` for "Only way in" is short to fit beside the provider name.
- French `Connexion en tant que` for "Signed in as" avoids choosing `connecté` or `connectée`.

## How to review

Each area has one file per language in `cy/` and `fr/` (`common`, `shell`, `auth`, `account`, `entries`, `competition`, `teams`). Keys are `area.thing`, and the English next to each is in `en/`. `catalogues.test.ts` checks that every English key has a Welsh and French entry and that `{placeholders}` match, so edits are safe to make directly.
