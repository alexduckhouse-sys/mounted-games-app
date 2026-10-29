# Event-day tools: broadcast, Live Activities, Wallet, vaccination checks and wind

Date: 29 October 2026. Status: implemented in the isolated event-day feature worktree. Production schema migration applied and verified; final release checks in progress.

## Scope agreed in this chat

Plan the four highest-rated additions from the review: a transparent broadcast overlay, Apple Live Activities, an event-specific vaccination checker, and Apple Wallet arrival/stabling passes. Add strong-gust warnings with rule-aware equipment advice and race alternatives.

Do not add CAPE/lightning alerts, automatic grass-going/stud advice, or a wet-bulb reading labelled as WBGT. This excludes new lightning functionality; it does not silently remove the existing thunder/rain feature. Its existing forecast-based thunder “all clear” wording is outside this implementation and must not be reused for wind.

This document supersedes the generic six-month-plus-21-day vaccination proposal and the suggestion that Live Activities only need light wiring in earlier proposals, including the overlapping entries in `docs/plans/2026-10-29-approved-features-and-connectors-plan.md`. It does not authorise that document's unrelated payment, location or predictor features.

The recommended approach is to extend existing workflows and services. A separate weather dashboard, a second scoring engine, and a general-purpose AI adviser would add complexity without helping the organiser. Suggestions come from reviewed rules and equipment records, not generated instructions at event time.

## What exists, and what is missing

| Area | Existing foundation | Work still needed |
| --- | --- | --- |
| Broadcast | Score cards, lane information, sponsor graphics, podium graphics and producer controls | Isolated transparent route, public snapshot, durable cues and consistent video delay |
| Live Activities | Swift widget/bridge, TypeScript helpers and real team-progress API | Native following integration, device registrations, APNs delivery, lifecycle and device validation |
| Wallet | Downloadable HTML arrival/stabling card | Correct entitlement aggregation, signed `.pkpass`, update service and current gate verification |
| Vaccinations | Passport board, reusable horse certificates and simple expiry/recent-jab checks | Versioned rules, evidence history, reliable horse linkage and separate inspection/admission decisions |
| Wind | Forecast endpoint, organiser weather line, pause/announcement workflow, race editor and equipment calculator | Gust intervals, rule provenance, permitted-action catalogue and protected programme changes |

Important findings:

- `BuiltInRaceMetadata.BuildRulebooks` explicitly labels all four organisation tabs as app guides whose body-specific rules are unverified. Those tabs are not authority for automatic advice.
- `RaceLibraryVariants` sources pairs rules from Pony Club but calls its individual adaptations unofficial. A generic individual variant must not be presented as an official IMGA or STRUK race.
- `SessionsController.ChangeRace` can rename races without the protections used by the full-programme editor. The new wind workflow must not call it unchanged or leave it as a bypass.
- Live Activities request `pushType: nil`; FollowingTab does not invoke the bridge. Current content has heat count, lane and status, not an ETA.
- The HTML pass uses signup status/counts, while stabling is also sold through separate shop orders. Paid entry does not establish paid stabling.
- `PassportCheckService.EvaluateStatus` can treat a prior manual check as certified without a complete vaccine history. That is not proof of compliance with a newly selected policy.

## 1. Wind warnings and permitted race changes

### The organiser's flow

1. Before the event, select its rulebook edition and event level. Sections may override the format/age-group context. Record venue-specific requirements, the published spare race and any authorised programme restrictions. Existing events start as “Rules not confirmed”; do not infer an organisation from a sponsor name or theme.
2. Add gusts to the existing weather page and the existing organiser weather line. Example: “Gusts up to 35 mph forecast, 14:00–15:00 · Review races”. Include when the forecast was fetched and show “forecast”, not “measured at the ring”.
3. Tapping opens a sheet with a large gust warning and recommended race changes with tick/cross controls. The tick opens the official preview; the cross dismisses that suggestion locally. There is no arena selector or equipment acknowledgement. “Continue for now” sits at the bottom right and only snoozes the prompt. “Send announcement” reveals the editor; sending remains a separate explicit action. No action is taken merely because the forecast crossed a number.
4. Each suggestion says one of: “Allowed by this rule”, “Referee decision required”, “Official Steward decision required”, or “Rule not verified”. The last state offers source/manual review, not an enabled automatic modification.
5. Preview the exact affected heats, rule/equipment changes and additional kit. Record the relevant official's decision and its scope, then apply one atomic change. Provide a separate explicit announcement action, or include the approved announcement in the same transaction/outbox as the change.
6. Scorers, ring crew, diagrams, equipment totals, programme/print views, public race labels, commentary and broadcast read the same effective race version. An organiser's acknowledgement is shared across devices; a personal snooze remains local.

### Gust data and warning behaviour

- Request hourly `wind_gusts_10m` and daily `wind_gusts_10m_max`; reuse the current weather provider and cache. Keep normal wind speed and gusts distinct.
- Open-Meteo defines hourly gusts as the maximum of the **preceding hour**. A value timestamped 15:00 belongs to 14:00–15:00. Store explicit UTC interval start/end, use the venue's local date for event-day selection, and fetch across midnight for the full two-hour look-ahead. Prefer epoch timestamps; a single fixed offset must not misinterpret the BST/GMT repeated hour.
- Normalise speed units in one adapter and display mph. Do not silently change units for existing consumers. Null/malformed values and fallback weather are unknown, never zero gusts.
- Proposed product prompts: 25 mph for advance equipment review; 35 mph for a more prominent official review. These are configurable awareness prompts, **not governing-body limits, equipment ratings or a safe-to-race threshold**. Show any lower venue/equipment operating limit prominently. Conditions on site can require action at any forecast speed.
- Look ahead two hours while racing remains scheduled. Show future-day gusts on the weather page during preparation. Reuse 10-minute normal/20-minute Lite polling and the provider cache; polling more often does not make hourly model output a live sensor.
- Deduplicate by event, arena, forecast interval and severity. Escalation to a stronger warning, a materially increased peak, or a new affected period breaks an earlier snooze. Use hysteresis for the prompt, with tested boundary behaviour, rather than repeated toasts.
- Display age of retained data; after the freshness bound show “Forecast unavailable” in the review sheet. Never show “safe” because data disappeared. A recorded wind pause persists independently of the forecast.
- On easing forecasts say “Gusts forecast to ease · Recheck the arena”. Resume always follows an on-site official decision. No automatic all-clear, cancellation, substitution or public announcement.
- Reuse the existing weather line rather than adding a header layer. When more than one hazard exists, its sheet lists all relevant hazards without losing a wind pause or creating competing banners. Add the `wind` pause reason to server validation and tag parsing.
- No background gust push in the first release: this is an organiser view while using the app, with forecasts available in advance. Background safety monitoring would need a separately operated service and is not promised here.

### Rule coverage and recommendation permissions

Review coverage means every supported family has an explicit evidence state. It does not mean every family has a verified permission. Governing organisation, rule edition, race format, age group, event level and venue conditions all matter.

| Competition family | Verified wind-related provision | What the app may propose |
| --- | --- | --- |
| Pony Club 2026 | Part 2, §22(q), printed p39: when an event cannot run, the Official Steward chooses the published spare event or voiding. Five Flag team and pairs versions explicitly allow bands to keep flags furled in windy weather. | Exact Five Flag option where the source covers that variant; published spare/void route with Official Steward decision. No arbitrary alternative on a prescribed Area/Zone/championship list. |
| IMGA 2026 | CR17, printed pp31–32: referee decides weighting cones/bins/buckets in blustery conditions; weights become equipment and subsequent heats in the session use the same arrangements. AO3.7, printed p39: referee, in consultation with organiser, may substitute a race when necessary. CR17.5 addresses interruption and programme decisions after a longer delay. | Present the named official decision, exact weighting conditions and consistency requirement; offer recognised same-format race alternatives only under the substitution authority and event's adopted rules. |
| MGAGB domestic events | The official rulebook page points to IMGA 2026; current supplementary handbook provisions were not retrievable. | Require confirmation of the event's published adoption/amendments before enabling an IMGA-backed suggestion. Do not equate “member of BEF” with one shared race policy. |
| STRUK 2026 | §§1.2.2–1.2.3, PDF pp6–7, and §1.3.1 cover starter-led wind stops/replays. Slam Dunk, PDF p67, allows a fifth rider to hold the stand in wind without leaning it to benefit the rider. | Starter review and the precise Slam Dunk team provision. Do not extend a fifth-rider allowance to pairs/individual helpers; general programme substitution authority was not verified. |
| EGUK | A current authoritative rulebook was not accessible in this review. The app's EGUK guide has no verified body-specific provenance. | General inspection prompt and manual official review only, until the actual event rulebook is supplied and checked. |
| Custom/friendly/training | Published local rules and the organiser's authority determine what can change. | Explicitly labelled local adaptation, with approval and equipment/setup notes; never call it an official-body allowance. |

Additional format checks:

- Teams, pairs and individuals each require their own race identity/variant and equipment counts. Unsupported combinations remain unavailable, even if a similarly named template exists.
- Pony Club senior, junior, novice/lead-rein variants and prescribed race lists are distinct. A rule verified for one must not be silently applied to another.
- Standard sessions, A/B/C finals, run-offs and heat–heat–final race rounds retain their existing scoring and qualification semantics. A substitution must cover the relevant complete unstarted contest, not one heat in a way that creates unequal programmes.
- IMGA's explicit “subsequent heats” equipment rule is different from replacing the race itself. Record the permitted effective-from-heat boundary; do not rewrite what earlier heats rode.

### Tyres around flags and quoits instead of bottles

Neither is a universal approved change in the reviewed books. Do not include either as an unconditional recommendation.

For tyres: distinguish weighting a cone/base from adding an obstacle beside a ridden line. IMGA's general weighting permission does not itself specify every tyre placement or make one safe. Only offer an exact reviewed arrangement with its authority, dimensions/placement and inspection notes. Do not recommend weights on bending poles by analogy with cones.

For quoits: distinguish changing an implement inside Bottle from substituting a complete recognised game. A permitted complete alternative uses its own rules, diagram, rider sequence and equipment. “Bottle, but use quoits” remains an unverified adaptation unless the applicable rules expressly allow it. For prescribed Pony Club lists, use the published spare/void process instead.

Concrete candidates for official assessment are IMGA **Hoopla** (team/pair/individual versions, printed pp61/95/123) and STRUK **Quoit** (all three formats, PDF p61). Placing a ring over a cone rather than balancing a bottle upright may reduce that particular equipment problem; that is a design inference, not a finding that either game is safe in a given wind. STRUK substitution authority still needs verification. A published Pony Club Two Flag spare may itself be wind-sensitive, so the spare is not an automatic solution.

Build a small curated recommendation table from verified clauses. Each item includes source URL, edition, page/clause, effective dates, permitted formats/ages/stages, exact change, authority, equipment effects and restrictions. Suggested replacement races must exist in that event's permitted catalogue and have the required kit. Rank by relevant equipment exposure and changeover effort; describe them as options to review, never “wind-safe races”. If no verified option exists, offer pause/manual review.

Do not use an AI model at runtime to reinterpret a rulebook, invent a gust limit, or approve an equipment change. A newly uploaded rulebook remains unverified until reviewed.

### Data, endpoints and safe mutation

Proposed names are implementation contracts to finalise during the first phase:

- Versioned `RulesProfile` catalogue and selected `CompetitionRulesProfile`, with section override, event level, published spare and source references. Store selected version IDs; catalogue updates do not silently alter active events.
- `WindMitigationRule` records in a reviewed catalogue, keyed by body/edition/canonical race/format and conditions. Keep original built-in race text intact.
- `RaceProgrammeRevision` and `RaceAdaptation` identify the actual effective race/diagram/rules for each affected scope. `RaceChangeDecision` records the before/after versions, affected IDs, approval authority, actor, reason and timestamp. A staff recorder may record an external referee's decision; login role is not proof of sporting authority.
- `POST .../wind-review/preview` evaluates the current programme and selected rule profile. `POST .../race-changes` applies a chosen reviewed proposal using an expected programme revision and idempotency key. Both require competition staff access; the public sees only approved effective race details.
- Run protection checks and writes in one transaction. Reject stale previews, cross-event targets, unauthorised policy changes and any attempt to overwrite a started/scored/signed-off race. Use a shared guard for legacy rename, programme-edit and new adaptation routes so the new protections cannot be bypassed.
- Bind offline score/start submissions to the race/programme version they were entered against. If a race changes while a scorer is disconnected, retain their work as a visible conflict; never attach old-game results to the replacement. Clients without a version must not submit to a changed race silently.
- Known unsent scores should warn before a change, but unseen offline devices cannot be reliably queried. The version check remains the protection when they reconnect.
- Persist scoring history. Do not clear results as a shortcut to substitution. If related heats already ran, offer the source's official interruption/void process; implement any results adjustment as a separate audited decision, not an automatic consequence of the weather sheet.
- Update `PlannedRaces`, per-letter `PlannedFinalRaces` and materialised heat races only where applicable. Linked race-final qualifiers/finals and run-off dependencies must remain coherent. Do not confuse a programme slot with an arbitrary `OrderIndex` from another round.
- The effective variant must drive race sheets, diagrams, printouts and `EquipmentCalculator`. Sequential reuse and concurrent-arena sums remain correct; additions such as authorised weights become counted equipment.
- Commit the change/audit/announcement intent together. Publish existing live invalidations only after commit; a durable delivery record lets missed notifications recover.

### Acceptance tests

Cover unit conversion, preceding-hour intervals, 24:00 crossings, BST/GMT, malformed/missing/stale data, cache coalescing, severity escalation and snooze. Test every rule row against the wrong body, edition, format and event stage; no match means no permission. Verify official authority and source appear in the preview. Test two organisers racing, score-vs-change races, all legacy mutation routes, offline old-version scores, multi-arena counts, A/B/C lists, run-offs and race-final links. No started/scored race or past equipment version changes. No forecast state resumes racing.

## 2. Transparent OBS/vMix broadcast overlay

### Flow and output

Add “Broadcast graphics” within existing Stream Controls. Choose arena, optional section and video delay; preview on a chequered background and copy a browser-source URL. The actual source is transparent and has no app navigation, audio or camera player.

Route: `/embed/competitions/:id/overlay?arena=<validated-arena>&delay=<bounded-seconds>`. Design at 1920×1080 and scale cleanly to 1280×720. Use the existing graphic look and safe placement; do not introduce a new visual style. It must work when no camera stream or Cloudflare credentials exist.

First release includes current lane line-up, next heat, score cards, standings, producer banners, sponsor graphics and podium reveal. Preserve server standings order, ties, sit-outs, HC treatment and the actual drawn lane order. Public rider display, if included, uses the existing privacy rules and locked declarations; default to team names.

### Architecture

- Extract presentation-only graphic components with explicit inputs. Keep existing app wrappers; do not mount `StreamOverlays` wholesale inside `/embed`, because it reads app context and renders opaque camera/reconnect covers.
- Extend the isolated EmbedApp. No auth storage, cookies, app API interceptor, service worker or score outbox. An explicit language provider and an embed-specific public live client are appropriate.
- `GET .../broadcast-snapshot` returns only public, arena-scoped graphics state with revision, `observedAt`, expiry and current unexpired cue. New/rejoined sources fetch the authoritative snapshot; public hub invalidations trigger reconciliation. Keep a bounded polling fallback.
- Persist producer show/skip/edit/podium cues with command ID, revision, start and expiry. Existing transient hub messages alone cannot reconstruct a cue after reconnect.
- Use an ordered bounded state/cue buffer for video delay. Delay all competitive graphics consistently, including line-ups, scores, standings and podiums. On first load or reconnect, either obtain retained public history for the delay interval or remain transparent while the delay buffer fills; never display the current result over older video.
- Retained history contains immutable public snapshots/cue payloads as they existed at their effective time. Fetching today's team name or corrected result when replaying an old cue would reveal later information. Corrections create a new version on the timeline. No private evidence is retained in broadcast history.
- Capture each history version coherently with the committed mutation; a cold join needs the baseline at or immediately before its delayed playback time plus subsequent changes. A later-current baseline is not a substitute. Remain transparent when the required history is unavailable.
- Expire queued graphics using the delayed presentation timeline, not their arrival time. Deduplicate commands and ignore older revisions. A deliberate immediate “Hide graphics” control may bypass delay and must be labelled accordingly.
- “Hide graphics” also invalidates queued earlier show commands; a delayed reveal must not undo it. Only a subsequent authorised show command restores output.
- On stale connection, remove time-sensitive “now” claims and expired cues. Default on-air failure is transparent; producer preview shows the diagnostic. Never cover the external feed with a reconnect box.
- Persist only the minimum public history needed for the maximum supported delay. Reuse existing stream-overlay revisions where possible; separate arena state/cues where the current competition-wide object cannot represent simultaneous programmes.
- Producer writes keep `CompetitionStaff` plus `CompetitionAccess`. Public snapshots omit private notes, ownership details and camera credentials. Preserve embed-only framing/CSP restrictions without widening unrelated routes.

### Acceptance tests

Verify transparent pixels and no page chrome; initial join mid-cue; reconnect after missing cues; command ordering/expiry; buffer warm-up and delay changes; two arenas; stale output; snapshot privacy; existing embed restrictions and headers. Test renamed races, corrected standings and withdrawn cues during the delay. Test in real OBS and vMix at 1080p/720p, including source hide/show and browser refresh. No new media-service fee is required; vMix licensing and ordinary hosting costs remain separate.

## 3. Apple Lock Screen and Dynamic Island Live Activities

### Flow

In the native iPhone app, add “Show on Lock Screen” to a followed team's existing card. Start with one explicitly chosen team; following a whole club must not create dozens of cards. Web/PWA following continues to work without displaying an unsupported control.

Use the real progress endpoint and existing truthful content: “2 heats to go · Heat 4 · Lane 3”, paused, waiting for draw, withdrawn and finished states. Do not add an “In 12m” promise in this release. If later added, it must be a labelled estimate from the timetable and disappear when stale/paused/undrawn.

Move coordination to an app-level native service/hook, not FollowingTab's mounted lifetime. Reconcile on app launch/resume, relevant live changes and reconnection; stopping/unfollowing ends the card. Respect user dismissal and disabled Live Activities.

### Delivery and lifecycle

- Change Swift to request an ActivityKit push token and observe token/state changes. Native registration must work when the WebView is suspended. Use a dedicated APNs payload encoder matching Swift `ContentState`, including Date representation; do not blindly forward API ISO strings.
- Store an installation-scoped capability in Keychain, hashed server-side, so anonymous public following need not force account creation. Its authority is limited to that installation's registrations. Validate installation registration, rate-limit creation and cap active registrations; consider platform attestation before broad rollout.
- Proposed records: `NativeInstallation`, `LiveActivityRegistration` and durable delivery work. Encrypt retrievable APNs tokens at rest, never log them, and validate topic/environment server-side. Sandbox and production destinations stay separate.
- Proposed endpoints: register installation; upsert/rotate activity registration; end/unregister; optional batched public progress read. Client-supplied scoreboard content is never authoritative.
- Coalesce authoritative progress updates after relevant committed changes: race/heat start or finish, timetable pause/resume, draw, team withdrawal, programme edits and event end. Use a durable DB outbox, leases, bounded retries and ordering; reuse `ReminderRunner` patterns without mixing Web Push and APNs token types.
- A process running in a Vercel container is not a guaranteed timer. Pair immediate bounded dispatch with an authenticated external wake-up/queue trigger for retries and freshness refresh. Redis transport does not replace durable work or wake a sleeping service.
- Reconcile the current 60-second stale window with delivery budgets. Event-only push would mark an unchanged card stale after a minute. Provide budget-aware freshness refresh, retaining honest “last updated” behaviour when delivery is delayed. Set the supported freshness contract from real-device/APNs tests; do not promise uninterrupted one-minute updates.
- Handle token rotation, unregistration/410, throttling, duplicate/out-of-order deliveries and user dismissal. APNs acceptance is not proof the phone displayed an update.
- Apple limits active duration to eight hours. Foreground resume may replace a nearing-expiry card; the existing 7.5-hour helper cannot restart it while the app has no runtime. First release tells the user to reopen after expiry. Push-to-start/all-day unattended restart is a separate opt-in follow-on, not part of the readiness claim.
- Define multi-day wording explicitly: current progress is competition-wide, so do not call a gap before tomorrow “finished for today” without a day-aware calculation. End when the followed scope ends.

### Acceptance tests and release prerequisites

Test foreground, background, terminated app, dismissed card, disabled permission, unfollow, paused/undrawn/withdrawn states, event-day rollover, eight-hour expiry, multiple API instances, worker sleep/recovery, token rotation and Swift payload round trips. Use real supported iPhones with and without Dynamic Island.

Release needs confirmed Apple team ownership/membership, bundle IDs, signing/provisioning, APNs capability and securely provisioned credentials. The checked-in Xcode team setting is blank. These are release prerequisites, not reasons to defer the design. There is no separate proposed APNs vendor subscription, but membership and delivery hosting are not assumed free.

## 4. Apple Wallet lorry and stabling passes

### Fix the pass's source of truth first

Create a canonical arrival-booking view shared by the existing HTML card, Wallet, booking screen and gate verification. Keep entry/admission entitlement, paid stabling, hook-up, allocations and vehicle details distinct.

- Explicitly classify relevant shop items and snapshot fulfilment kind on order lines. Do not prove stable entitlement by matching “stable” in a product title. Historical ambiguous lines need organiser review.
- Link a booking to its actual entry/order lines and allocations. Allow several vehicles/bookings for one purchaser and several source orders per booking. Do not assume one signup equals one lorry.
- Allocate quantities transactionally: the total assigned across bookings cannot exceed the current eligible quantity of a source line, and the same stable/night allocation cannot be assigned twice. Preserve date/night scope. Refunds, reallocation and concurrent staff edits revalidate entitlement and allocation in the same transaction; conflicts do not mint a fresh valid pass.
- Preserve legacy allocations with provenance and reconcile duplicates. The same purchase cannot provide capacity twice through signup extras and shop orders.
- Pending payment is visibly pending. A stable refund removes that benefit without necessarily cancelling valid day admission. Test/demo orders never grant real-event benefits.
- Use the same canonical projection for allocations and capacity where they overlap, so Wallet cannot disagree with the organiser's screen.

### Wallet flow

From the entrant's booking/pass screen, “Add to Apple Wallet” downloads a server-signed `.pkpass`. It also works in Safari without the native app. Include event/date, vehicle, relevant allocations/counts and a QR code; omit unnecessary entrant/rider details. Preserve the printable/HTML alternative for other devices.

Use an opaque pass reference in the QR. Scanning opens a staff-authorised gate lookup showing current benefits and allocations. A reference is not authentication; it must not expose a public record of vehicle or customer data. Reuse competition staff access initially; a dedicated gate-only role can follow if needed.

A saved pass remains displayable offline, but cannot prove it has not been refunded since its last update. First release makes gate verification online and labels unavailable verification honestly. A full offline gate manifest/check-in system is outside this first release.

### Data and update service

Proposed records: `ArrivalBooking` with source entitlement/allocation links, `WalletPass` (stable serial, booking, revision, expiry/void state and protected authentication token) and Wallet device registrations. Keep installation identity for Live Activities separate from Wallet device registration semantics.

Generate the pass server-side using a Pass Type ID certificate and its certificate chain. Serve `application/vnd.apple.pkpass` privately with no public/CDN caching. Certificate/key provisioning and renewal are an operational requirement; private keys never enter web code.

Support standard PassKit register/unregister, changed-serial and latest-pass endpoints. Authenticate each according to Apple's protocol. Wallet registration tokens and retrievable push destinations require protected storage and log redaction. Store the pass authentication token encrypted so updated packages can contain the same token; a digest alone cannot recreate it. A separate digest may support constant-time verification. Reissue with the same serial and a higher revision after allocation, vehicle, date, venue, refund or cancellation changes. Wallet pushes tell the device to fetch the latest signed pass; they are not ActivityKit content updates.

The changed-serial endpoint needs a monotonic collection-wide change cursor for the pass type, filtered to the requesting device's registrations. Independent pass revision numbers are insufficient: changing a low-revision pass must remain visible after a different pass reached a high revision. Ensure commit ordering cannot skip an earlier allocated sequence that commits later; use a committed change-log cursor/watermark with tested concurrency semantics. Cover first registration, empty change sets, removals and concurrent updates according to the PassKit protocol without leaking unregistered serials.

Reuse durable dispatch/wake-up mechanics, not Live Activity payloads. Add date/location relevance so Wallet may suggest the pass near arrival; do not guarantee a Lock Screen pop-up or request browser GPS when opening the site.

### Acceptance tests

Paid entry/unpaid stabling; paid stabling without signup; several orders/vehicles; partial cancellation/refund where supported; changed allocation; legacy duplication; ownership and cross-event access; signed package/MIME/serial; pass refresh/void; certificate expiry; Safari download and actual Wallet install on a real iPhone. Include two organisers allocating the final stable/night, routine updates preserving the authentication token, and pass B changing from revision 1 to 2 after pass A reached revision 10. Gate lookup must show current status even when the displayed pass is stale. No change to payment processing is included.

## 5. Event-specific vaccination checks

### User flow and evidence

The organiser selects a versioned organisation policy plus applicable venue requirements and arrival-date basis in the existing passport settings. The entrant can check their own declared pony before travel; staff inspect the passport and record the admission decision in the existing board.

Separate evidence, calculation and decision:

1. Recorded vaccine dates/history and evidence completeness.
2. Calculated result under the event's pinned policy version.
3. Manual passport inspection and official admission decision, with actor/date/reason.

Use “Dates meet the selected rules”, “Needs attention”, “Missing history” and “Official review needed”. Show recommendation messages separately from mandatory failures. Do not silently turn an override into a calculated pass or treat a passport check as a health diagnosis.

### Policy evidence as of this review

| Policy | Verified position | Release treatment |
| --- | --- | --- |
| Pony Club January 2026 | Annual booster maximum is mandatory; six months plus 21 days is recommended. Primary-course timing, historical cohorts, stand-down and documented exceptions apply. Certain venues impose additional rules. | Build a sourced preset with separate recommendations and explicit exception review. |
| FEI | British Equestrian describes arrival-based six-month-plus-21-day and seven-clear-day requirements. A current detailed 2026 primary regulation was not verified in this review. | Confirm the current official edition before enabling a complete automatic preset; do not relabel a 2025 document. |
| MGAGB | Official website lists a vaccination policy but accessible text did not establish its operative rules. | Source required; manual review until verified. |
| EGUK / STRUK | No authoritative current vaccination policy verified. | Source required; manual review, not assumed exemption or inherited FEI policy. |
| Local/venue requirements | May supplement or differ from sporting-body rules. | Explicit source and version; evaluate each applicable requirement without overwriting the organisation result. |

### Data and evaluation

- Define versioned policy records with source, edition, effective dates, verified-on date, mandatory/recommended clauses, calendar intervals, cohort rules, reference-date basis and exceptions. Pin event selection; later policy updates require an explicit event review.
- Use local calendar dates for vaccination and arrival/attendance. Do not implement six calendar months plus 21 days as a fixed number of days. “Seven days” and “seven clear days” need distinct tested semantics according to the selected text. Arrival before competition start changes the answer.
- A last jab alone cannot establish a complete primary course or absence of a historic lapse. Store history/completeness and return “Missing history” when appropriate. Do not penalise recommendations as mandatory failures.
- Let authorised entrants enter provisional dates for their own declared pony before inspection. Label the result as based on supplied dates. Keep that draft separate from staff-verified evidence and never let it overwrite a shared certified record or count as a completed passport inspection.
- Evidence edits and staff inspection use expected revisions. A concurrent entrant correction must not be lost or leave an earlier admission decision looking current. Preserve both provenance and the exact evidence/policy revision inspected. A small date/history form is sufficient; document uploads are not required in this release.
- Establish stable horse-record identity and explicit declaration links. Normalised pony name within a team is insufficient to merge records safely. Reuse `CertifiedHorse` only through authorised explicit linkage; retain its historical inspection separately from current event compliance.
- Suggested additions: `VaccinationPolicyVersion`, event policy/venue selections, dated evidence records, and versioned evaluation/inspection/admission records. Keep policy configuration distinct from arbitrary dec-form question rules.
- Extend staff passport endpoints; add an entrant preview/evaluation endpoint restricted to their authorised declaration and linked pony. No global passport search or public health-history API. Changes to pony, dates, arrival, event date or selected policy invalidate/recompute the previous evaluation while preserving audit history.
- Legacy “Certified” rows become legacy manual inspection evidence, never an automatically complete vaccination history. Do not infer missing dates during migration.
- Show next relevant date/deadline only where it follows from the selected rules, with source/reason and a clear request for official review when an exception applies.

### Acceptance tests

Test day 6/7/8 boundaries for each policy, arrival before event start, annual intervals, six calendar months plus 21 days, leap years/month ends, future dates, incomplete primary courses, gaps, pre-2024 cohorts, documented exceptions and stricter venue requirements. Test same-name ponies, changed declarations, cross-club access, a policy version change and an entrant edit while staff inspect the passport. Public DTOs/exports/hub messages must not reveal private passport or vaccine evidence.

## Shared implementation requirements

- Extend existing screens and Refine controls, using UK English and the humanise guidance. Settings autosave; consequential programme changes, admissions and announcements use explicit action/preview. Preserve current navigation, motion and all five themes. Verify 390×844 and 1440×900; reduced motion and Lite mode remain supported.
- English/Welsh/French keys and placeholders stay aligned; Welsh/French draft wording requires human review before claiming reviewed translation.
- API authorisation is authoritative. Public broadcast/following data never grants access to bookings, passports, private declarations or producer controls.
- Every schema addition requires EF migration, idempotent Postgres SQL, SQLite guard, schema tests, and updates to competition/account deletion, export/retention and demo cleanup where applicable. Do not copy sensitive evidence or delivery tokens into saved competition templates.
- Keep DTOs and numeric enums aligned with TypeScript. Durable work is idempotent and bounded, with multi-instance leases and recoverable retries. Test cancellation/revocation between claim and send.
- Do not read credentials to plan this work. Later deployment needs the owner's existing authorised process; this task makes no configuration, CI or production changes.
- Open-Meteo's hosted free tier excludes commercial use. Confirm eligibility or budget for the licensed endpoint before launch; preserve attribution and caching. Apple signing/membership and hosting are operational costs, even where no per-pass service fee is added.

## Build sequence and completion checks

| Phase | Deliverable | Evidence required before completion |
| --- | --- | --- |
| 0 | Freeze contracts, source catalogue, rule coverage and rollout switches | Verified policy/race-source fixtures; explicit unknowns; source-of-truth review for bookings; named Apple/wake-up prerequisites |
| 1 | Transparent overlay | Public snapshot/cues, isolated renderer, delay/rejoin tests and real OBS/vMix session |
| 2 | Gust display and organiser review | Correct intervals/units, deduplication/staleness, manual pause/resume, no automatic rule changes |
| 3 | Rule-aware adaptations and substitutions | Shared mutation guard, official preview, version-bound offline writes, effective equipment/diagram/print views, concurrency and history tests |
| 4 | Native Live Activities | Following opt-in, APNs registration/delivery, freshness/expiry contract and real-device background tests |
| 5 | Vaccination profiles and pre-check | Verified presets only, evidence/inspection split, legacy migration, policy boundary and privacy tests |
| 6 | Canonical arrival booking and Wallet | Entitlements reconciled, signed pass/update service, gate authorisation and real iPhone verification |

Phases are independently reviewable. Native signing, rule-source retrieval and booking reconciliation can be prepared while the overlay/gust UI is built. Do not block all five features on an inaccessible rulebook: ship general gust awareness and source-verified options, with unverified organisations explicitly remaining manual.

For code phases, run root `npm run build`, relevant tests while developing, then root `npm test` and the repository's web lint/coverage and API coverage gates before shipping. Add realistic concurrency, privacy, timing and protocol tests rather than tests that merely mirror implementation. No new packages, commits, deployment or production schema changes are performed by this planning task.

## Implementation map

| Area | Existing entry points | Likely additions |
| --- | --- | --- |
| Weather | `api/Controllers/WeatherController.cs`; `api/Services/WeatherCache.cs`; `web/src/hooks/useDayForecast.ts`; `web/src/lib/weatherAlert.ts`; `web/src/components/WeatherAlert.tsx`; `WeatherSheets.tsx` | Gust adapter, wind-review sheet, rule-aware recommendation service |
| Race changes | `api/Controllers/SessionsController.cs`; `api/Services/RaceVariants.cs`; `BuiltInRaceMetadata.cs`; `EquipmentCalculator.cs`; score outbox and scoring services | Rules profiles, programme revision/decision service, shared protection, effective variant resolver |
| Broadcast | `api/Controllers/StreamOverlaysController.cs`; `api/Entities/StreamOverlay.cs`; `web/src/pages/embed/EmbedApp.tsx`; `web/src/components/stream/StreamOverlays.tsx`; `useEmbedResource.ts` | Public broadcast snapshot, durable arena cues/history, transparent renderer and source setup |
| Native | `web/src/pages/competition/FollowingTab.tsx`; `web/src/native/liveActivity.ts`; `web/ios/App/App/LiveActivityPlugin.swift`; `TeamProgressActivities.swift`; `api/Controllers/TeamProgressController.cs`; `api/Services/TeamProgress.cs` | Native coordinator, installation/registration API, APNs provider/outbox worker |
| Wallet | `web/src/lib/stablingPass.ts`; `MySignupsPage.tsx`; `SignupDetail.tsx`; `api/Controllers/SignupController.cs`; `api/Services/VenueCapacity.cs`; commerce entities | Arrival booking projection, explicit entitlement kind, PassKit issuer/update endpoints and gate lookup |
| Vaccinations | `api/Services/TackCheck/PassportCheckService.cs`; `api/Entities/TackCheck.cs`; `api/Controllers/TackCheckController.cs`; `web/src/pages/eventTools/PassportCheckTab.tsx` | Versioned policy evaluator, evidence links, entrant pre-check and separate admission decision |
| Shared | `api/Services/Notifications/ReminderRunner.cs`; migrations/SQLite guards; `web/src/types.ts`; live hub; i18n catalogues | Durable transport-specific delivery, revisions, recovery and contract tests |

## Sources and remaining verification

Primary sources were checked on 29 October 2026. Absence of a located clause is not proof that an organisation forbids an action; it means the app cannot advertise permission on this evidence.

- [Open-Meteo variables and time semantics](https://open-meteo.com/en/docs), especially `wind_gusts_10m`; [hosted-service pricing](https://open-meteo.com/en/pricing).
- [IMGA 2026 rulebook](https://mounted-games.org/wp-content/uploads/2026/02/IMGA-Rule-Book-2026.pdf): CR17 and AO3.7, plus exact race/equipment clauses.
- [Pony Club Mounted Games official page](https://pcuk.org/sports/mounted-games/) and [2026 rulebook PDF](https://resources.pcuk.org/wp-content/uploads/2025/12/RULEBOOK-Mounted-Games-2026-Web.pdf): prescribed race lists and §22(q), printed p39. PDF one-based page numbers are printed page plus one.
- [MGAGB rulebook page](https://www.mgagb.co.uk/rulebook) and [supplementary handbook page](https://www.mgagb.co.uk/mgagb-handbook): IMGA 2026 reference confirmed; operative supplement remains unverified.
- [STRUK current rulebook landing page](https://www.strukevents.co.uk/copy-of-rules), [2026 PDF](https://www.strukevents.co.uk/_files/ugd/7ce1db_f7566f4e7397456db2a0497c226a5598.pdf). The older `/rules` page advertises 2025; do not select that edition by accident. STRUK describes stunt racing; it is not a Scottish governing-body label.
- [Pony Club January 2026 vaccination policy](https://resources.pcuk.org/wp-content/uploads/2024/08/The-Pony-Club-Equine-Influenza-VACCINATION-RULE.pdf).
- [British Equestrian explanation of FEI vaccination requirements](https://www.britishequestrian.org.uk/equine/passports/fei-passports), [MGAGB policy index](https://www.mgagb.co.uk/latest-policies-and-procedures). Detailed current FEI and MGAGB presets still need operative primary documents; EGUK/STRUK vaccination rules also remain unverified.
- [Apple Live Activity lifecycle](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [APNs integration](https://developer.apple.com/documentation/ActivityKit/starting-and-updating-live-activities-with-activitykit-push-notifications).
- [Apple pass building](https://developer.apple.com/documentation/walletpasses/building-a-pass), [Wallet distribution/updates](https://developer.apple.com/wallet/get-started/), [Lock Screen relevance](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen).
- [OBS Browser Source](https://obsproject.com/kb/browser-source), [vMix transparent browser input](https://www.vmix.com/help26/WebBrowser.html).

Open release items: authoritative EGUK rules; MGAGB adoption/amendments; current detailed vaccine policies beyond Pony Club; exact approved implementation of any tyre/quoits adaptation; Apple account/signing access; external delivery wake-up; Open-Meteo licence eligibility; real-device and broadcast acceptance sessions. These are listed dependencies, not claimed completed work.


## Implementation notes — 29 October 2026

The implementation follows the four-feature scope above plus gust review. It adds no lightning/CAPE alert, equine WBGT diagnosis, inferred going or stud recommendation.

- Broadcast: isolated transparent source, public immutable history for up to 120 seconds of video delay, lane line-ups, results, standings, banners, sponsor name rotation and podium controls. Producer hide discards queued earlier output. The source stays transparent when its required history is missing or stale. Predictions/favourites are outside this first release. Real OBS/vMix acceptance remains a release check.
- Wind: forecast gust intervals and configurable review prompts; explicit rulebook/adoption selection, sourced format-specific guidance and official approval before a programme replacement. Programme revisions protect scoring history and offline submissions. Tyres around flags and implement swaps are never presented as blanket permission. Unknown editions remain manual review.
- Vaccination: private evidence with immutable policy versions, explicit horse identity, revised-history checks and separate official inspection. The automatically evaluated edition is Pony Club 2026. Other bodies require an official check. Legacy notes remain; the former global pony-name certification lookup is retired.
- Apple: explicit native Lock Screen opt-in, installation capabilities and APNs delivery; canonical paid arrival bookings with conserved quantities, resource/night allocations, stable signed Wallet passes and collection-wide change cursors. See [Apple setup](../apple-event-day-setup.md). Apple configuration is required before enabling production delivery.
- Account handling: event-record download is available on My account; deleting an account removes its arrival bookings and anonymises vaccination/decision actor links. Event cleanup covers the new records.

The PostgreSQL migration is `20261029125930_AddEventDayTools`, with the idempotent script in `api/Data/Migrations/Scripts/AddEventDayTools.sql`. Its forward operations only add columns/tables/indexes and seed policy/clock records. Existing order-line fulfilment revisions start at 1, matching SQLite upgrades. Applied to Neon production on 29 October 2026 after applying the script twice on isolated branch `verify-event-day-tools-20261029` (`br-silent-bonus-b4miz833`). Verified 20 feature tables, 10 new columns, one migration-history row, six policy presets and fulfilment revision default 1. Recovery branch `before-event-day-tools-20261029` (`br-wispy-tree-b4i0qeku`) preserves the pre-migration state. The worktree includes the current main-branch scoring and Format-page retirement changes. The separately requested duty-wizard production migration was completed independently.

Release checks still needed: registered Apple signing and APNs credentials, physical-iPhone background activity and Wallet updates, external delivery wake scheduling for a sleeping API, actual OBS/vMix source checks, human review of Welsh/French additions, rulebook updates beyond the verified editions, and applicable Open-Meteo commercial-use terms. No new package was installed. Apple delivery remains configuration-gated until these operational checks are completed.

## Verification — 29 October 2026

- Full web suite after integration: 573 files, 6,718 tests passed. Node suite: 124 passed. Final web coverage: statements 98.55%, branches 97.02%, functions 98.20%, lines 99.33%; all unchanged 97% gates passed. The earlier 96.92% branch result was addressed with recommendation and offline-start regression tests.
- Full API rerun after integration: 3,399 passed, eight Redis-dependent tests skipped, no failures.
- API line coverage: 95.27% (34,223 / 35,921), above the unchanged 95% gate. Two integration-test fixture failures in that coverage run were corrected and the full rerun passed.
- Web production build, TypeScript, full ESLint and whitespace checks passed. API build reported zero warnings/errors; EF reports no pending model changes. Unsigned iOS simulator build passed; this does not establish signed physical-device delivery.
- Browser checks covered the transparent overlay at 1080p/720p, mobile wind review and vaccination layouts. The latest wind review uses a fake event and sample 35 mph forecast. The announcement editor remains hidden until requested.
- [Wind review before](../designs/event-day-tools/wind-before-phone.png) and [after](../designs/event-day-tools/wind-after-phone.png), both at 390×844. [Transparent broadcast overlay](../designs/event-day-tools/broadcast-overlay.png).
- The complete web rerun used four workers and a 60-second per-test allowance on the busy development machine. No source timeout setting, assertion or coverage exclusion was weakened.
