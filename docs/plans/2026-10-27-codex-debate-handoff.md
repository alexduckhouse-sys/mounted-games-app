# Codex handoff: feature ideas to debate (27 October 2026)

## How to run this

Give Codex this file. Suggested prompt:

> Read `docs/plans/2026-10-27-codex-debate-handoff.md`, then `CLAUDE.md`, `APP_DESIGN.md`, `docs/decisions.md` and whatever code each item points at. For each item, argue the case for and the case against (steelman both), using what the code and the real Mounted Games world tell you, then give a verdict: **build now**, **build later (with the trigger)**, or **drop**. Say what it would cost to build (S/M/L and the main risks) and list the questions only the owner can answer. Read-only: don't change code. Write your results to `docs/audits/codex/2026-10-27-feature-debate.md`.

Run it read-only (`command codex` with the read-only sandbox). Item 6 (iOS app) is the big one; give it the most depth.

## Background

MG App runs Mounted Games competitions on phones at showgrounds: organisers run entries, the draw, the timetable and live scoring; trainers send dec forms; families and spectators follow live results, chat and a live stream. Most competitors are children, so `NoFilming` and `UseInitialOnly` (rider privacy) and the safeguarding rules matter. The web app is a React PWA with offline caching and web push, plus an ASP.NET Core API on Vercel and Neon Postgres. Signal at showgrounds is often weak.

On 27 October the owner reviewed a list of ideas:
- **Building now:** weather alerts for organisers, emails when entries open (nearest events first, location never asked), Welsh and French, a results export for governing bodies, an after-event feedback form, and a post-event report.
- **Dropped:** club training mode, pony workload caps, rider grading, photographer hookup (see `docs/decisions.md`).
- **The items below** are the ones the owner was unsure about or didn't answer. The owner's own words are quoted.

## Items to debate

### 1. iOS app (lock-screen "you're up next" Live Activity)
- Owner: "honestly a ios app could be worth it imma have a big debate on it".
- The idea: a thin native iOS app, so a family sees "2 heats until your team" on the lock screen and Dynamic Island, with sharper notifications. A PWA can't do Live Activities. The owner also writes Swift (a side-project iOS app, MyYard).
- To weigh: a native shell (SwiftUI with web views, or Capacitor) vs a full native app; App Store review and the cost of keeping two clients in step; how much of the value web push already gives (`web/src/lib` push helpers, `NotificationScheduler`, iOS 16.4+ home-screen PWA push); Live Activity updates need APNs push-to-start/update tokens from the API; offline score outbox parity; whether organisers or families would actually install it; Android (nothing like Live Activities, though ongoing notifications exist).
- The owner needs: build or not, and if so the smallest first version.

### 2. Saving whole live streams to watch back
- Owner: "we might want to save full live streams somwehere so they cna be watched back . again needs decisions".
- Today: streams go through Cloudflare Realtime SFU (WebRTC/WHEP, `api/Services/Streaming/`, `web/src/live/`). The only replay is a 30-minute IndexedDB buffer on the producer's device (`replayBuffer.ts`). Nothing is recorded on a server.
- Decisions needed: where recordings live (Cloudflare Stream recording, or the producer uploading to R2) and the cost per event hour; how long they're kept; who can watch (public, entrants only, organiser only); safeguarding (riders with `NoFilming`, children on a permanent recording, consent wording in `SignupTerms`, takedown requests); chapter marks per heat or race from scoring timestamps; whether this replaces the highlight-clip idea (owner's item 9).

### 3. SMS backup for critical alerts
- Owner: "5 is ok ood idea to say somewhere".
- The idea: ring calls, delays and emergencies also go by text, because showgrounds often have signal but no data.
- To weigh: cost per UK SMS (Twilio and similar) and who pays; we only hold trainer phone numbers from dec forms (`api/Services/DecForms/PhoneNumbers.cs`), so consent for texts is needed; opt-out rules (PECR) and an alphanumeric sender ID; abuse limits; whether to limit it to emergency use (`VolunteerAndEmergencyController`) and leave out routine ring calls.

### 4. Rulebook assistant (AI)
- Owner: "hmmmmmmm add as a possibility".
- The idea: ask "can a rider remount after a fall?" and get an answer quoting the paragraph from the four stored rulebooks (EGUK, Pony Club, MGA, STRUK; `RulebooksController`, `docs/pc-mounted-games-race-rules-2026.md`). It would sit in the Rulebooks tab and the scorer's race tools.
- To weigh: a wrong answer during a dispute is worse than no answer (always quote the source and say it isn't a ruling); cost per question and rate limits; rulebook copyright; offline at the showground (it won't work there, so the plain rulebook stays the main tool); whether better search through the rulebooks gets most of the value without AI.

### 5. Card or bank payments (GoCardless)
- Owner: "go cardless huh i will look into it".
- Today: real events record Pending entries for manual BACS; demo events use a test payment page (`docs/decisions.md`, 2026-10-22). Club payouts are a mock of provider onboarding.
- To weigh: GoCardless (bank payments, Instant Bank Pay) vs Stripe (cards, Apple Pay) vs keeping BACS; fees on a £20–£60 entry; refunds and the waiting-list flows; who the merchant is (the organiser, the club, or us as a platform), which decides the regulatory position; reconciliation work saved for show secretaries.

### 6. Wallet pass for each entry
- Owner: "4 could be added but honestly u kind of rock up . so could be use full iguess but unlickely".
- The idea: an Apple and Google Wallet pass with the bib number, stable number and an arrival QR code, which updates when the draw or times change.
- To weigh: families mostly just turn up, so the arrival QR may not be used; pass signing needs an Apple certificate and the Google Wallet API; maybe only worth it if item 7 or the iOS app happens.

### 7. Arrival desk (owner didn't answer)
- The idea: teams scan a QR code on arrival, so the secretary sees no-shows before the draw is final. Check first what `SessionsController` and `ScorerController` already do for check-in, and how withdrawals and no-shows work today (`Team.EntryStatus`, `WithdrawalRedrawService`).

### 8. Prediction game for supporters (owner didn't answer)
- The idea: supporters pick the A Final podium, with no money involved, to keep people on the live pages between heats.
- To weigh: children's names and any leaderboard (`UseInitialOnly`); keeping well away from anything that looks like gambling; whether it adds load at the busiest moments (`LiveHub` fan-out).
