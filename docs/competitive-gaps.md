# Competitive gaps and sales ideas (22 October 2026)

Research notes for making the app easier to sell. Checked against `main` at PR #55 and `NEXT_STEPS.md`; none of these items were already listed there. Rules and points work is covered by another chat and is left out.

Status: **all points decided on 22 October** (point 2 only as a test payment page). Decisions are marked **Decided**. Build work is split into one PR per stage; see the PR list on GitHub for progress.

## Market

No software built for mounted games turned up. The USPC runs games on an Excel template (11 tabs, up to 20 teams per division). The MGAGB site names no entry or results system. Existing UK Pony Club tools only cover entries.

| Competitor | Does | Doesn't |
| --- | --- | --- |
| [Entrymaster](https://pelham.pcuk.org/?p=3082) | Entries, Stripe payments (1.5% + 20p, plus £1 per event), Pelham membership checks, steward sheets, emails, public calendar | Live results |
| [Horse-Events](https://pelham.pcuk.org/horse-events/) | Entries; free for Pony Clubs, booking fee from about 80p | Live results (none found) |
| [Horse Monkey](https://horsemonkey.com/organisers) | Entries, start lists, live results, about £1.50 per event | Heats, draws or team scoring |
| [Equipe](https://help.equipe.com/articles/online-results) | Follow a rider or horse, push when a start list goes up or a horse finishes, rider results history, archives | Mounted games (dressage and jumping) |
| [SportsEngine Tourney, TeamLinkt](https://mwm.ai/apps/teamlinkt-tournaments/6738714044) | Follow-a-team alerts, delay and reschedule alerts, no account needed | Equestrian specifics |

Pricing comes from vendor pages and a rival's comparison page and may be out of date. The Pony Club comparison PDF could not be read. No EGUK-specific site was found.

**Position:** nobody owns the competition day itself. We already have live heat scoring, an offline score outbox, draw previews, seasons, and live video with overlays. The pitch is "runs the whole day", complementing Entrymaster for entries and not fighting it.

## Gaps, ranked

1. **Scoring needs the shared admin key.** `ScoringController` is `[Authorize(Roles = Admin)]` and there are no individual admin accounts, so a volunteer scorer must be given the key to everything.
   - **Decided: both.** Arena-scoped scorer links (QR or PIN, scores only, expire after the event, revocable, every score recorded against the link's name) and scorer accounts granted per competition. Links for the day, accounts for regular scorers.
2. **Real card payments.** Paid entries stay Pending until confirmed by hand; the Stripe code is demo-only.
   - Options: Stripe Connect into the organiser's account (biggest build: refunds, webhooks, payout reports); stay manual and import Entrymaster entries by CSV; or CSV import now and Stripe once a paying customer asks.
   - **Decided (22 October):** no real payments for now. Add a clearly labelled **test payment page** to the entry flow, shown on demo competitions only (the existing rule: real events never call fake payment endpoints, so nobody believes they have paid). Real events keep "pay the organiser directly". Stripe vs CSV import stays open.
3. **Consent and safeguarding for juniors.** Entries capture no photo or video consent, emergency contact, medical notes or accepted terms. We stream under-16s with no way to exclude a child whose parents refused. Idea: a per-rider consent flag that hides them from stream overlays, score cards and the shop, with later withdrawal. See [NSPCC guidance](https://sport.nspcc.org.uk/resource-library/feature-boxes/key-info-photography/).
   - **Decided (22 October):** a yes/no "may be filmed" choice, ticked on the parent's behalf and stored per rider (so reserves and swaps carry their own answer; forced choice, no blank). It applies per **heat**, not per session. If a heat has an opted-out rider, the producer gets a **warning only**; they can still go live. Names always stay public; showing first name and initial only for juniors is a possible later organiser setting. The app can't stop spectators filming on their own phones, and the notice should say so.
   - **Decided (22 October):** the opt-out affects live video only (the heat warning). Overlays, score cards and shop photos are not changed. The sign-up tick covers filming plus the event terms and conditions. Emergency contact and medical notes are not decided.
   - **Also decided (22 October):** sign-up gets one blanket tick, "I have parental consent for all riders on this entry to be filmed" (assumed to sit alongside accepting the terms; to confirm). It sets the default for every rider, the per-rider choice stays for exceptions, and we store who ticked it, when and the wording version.
4. **Email.** No email is sent at all: entry confirmations, receipts, "your heat time changed" and results summaries are missing. iOS push only works once the PWA is on the Home Screen, so many parents will not get pushes.
   - **Decided (22 October):** send **one** email, an entry confirmation, to the adult's contact address (never a child). Competition-open alerts go only to people who opt in (unticked box, unsubscribe link in every email, UK marketing-email rules). Likely provider for the alerts: Omnisend; not yet checked for the one-off confirmation (a transactional sender such as Resend or Postmark is the alternative). Schedule-change emails, results summaries and organiser broadcasts are out for now.
5. **Withdrawals and substitutions.** No scratch, no-show or rider-swap flow, and the draw does not re-flow when a team drops out.
   - **Decided (22 October):** the organiser can mark a team withdrawn or a no-show and swap a rider (reserve in). The app shows a re-draw preview of the affected unscored heats and applies it only when the organiser confirms; scored heats are never touched. Trainer-side requests are not included.
6. **Shareable links.** No Open Graph tags (shared links show a blank preview), no "add to calendar" (.ics) or calendar feed, no QR codes. Ideas: a per-team results card, a venue poster QR, a "my team's heats" feed.
   - **Decided (22 October):** build link previews (Open Graph), add to calendar (.ics download plus a subscribable "my team's heats" feed), and QR codes (venue poster to the competition, one per team supporter join key). The shareable team results card is **not** included for now.
7. **Organisations, not just organisers.** No club, branch or federation entity with its own logo, colours, several organisers and roles. `decisions.md` lists delegated organisers as "revisit if". Selling to an area, league or EGUK needs this plus a data-export and privacy pack.
   - **Decided (22 October):** an organisation that owns competitions and seasons, has a logo and colours shown on its pages, and has several members with roles (owner, organiser, scorer). Own subdomain or domain per organisation (full white-label) is not included. This builds on the scorer roles from point 1 and replaces the "revisit if delegated organisers are needed" note in `decisions.md` once built.
8. **Sponsors and reporting.** Sponsor slots on public pages, the timetable and results, with a proof-of-display report. A post-event committee report (entries, income, schedule slippage, shop sales); the drift data is already recorded.
   - **Decided (22 October):** sponsor logos and links shown on the timetable, results and competition pages and in stream overlays, with a count of how often each was shown; and a printable post-event committee report (entries and income, schedule slippage, viewers, shop sales, sponsor exposure). The separate per-sponsor proof-of-display PDF is not included for now.
9. **Embeddable results.** An iframe widget or public read-only JSON so clubs can publish results on their own sites.
   - **Decided (22 October):** an embeddable widget (pasted snippet) showing live standings, results or the timetable for a competition or season, in the organisation's colours, public data only. A documented public JSON feed is not included. Build note: the widget routes need their own framing rule in the CSP and headers (`docs/security-review.md`), kept off every other page.
10. **Store presence.** No Capacitor or native wrapper. App Store and Play listings give discoverability and reliable push.
   - **Decided (22 October):** stay a PWA, no store listings. Improve the install prompt, with a clear "add to Home Screen" guide for iPhones so push works.
11. **Medium.** A protest or referee-decision log that blocks sign-off (overlaps the rules chat); Welsh and French language for the internationals; an accessibility pass.
   - **Decided (22 October):** build all three. Protest log: open protests block result sign-off, and the decision and reason are kept; check with the rules chat first. Welsh and French: needs a translation layer through the whole app and native-speaker review. Accessibility pass: contrast, screen-reader labels, keyboard use and text sizes on the main pages.

## Suggested order

First PR: point 1 (scorer links and accounts) with point 3 (consent flags), since both are trust points a committee will ask about. Point 6 is a small, cheap win. Point 2 decides who we are to organisers.
