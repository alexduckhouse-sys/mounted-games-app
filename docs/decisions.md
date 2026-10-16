# Project decisions

## 2026-10-15: Trainers organise their own competitions
- Why: self-service trainer registration must not grant access to another organiser's competition or entrant records.
- Rule: admins can use organiser endpoints for any competition; trainers can use them only where the stored `CreatedByUserId` matches their authenticated ID. Managers and members are not organisers.
- Rejected: admin-only creation; the user wants trainers to create competitions too. Global trainer access was rejected by the ownership confirmation.
- Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Revisit if: delegated organisers are needed; add an explicit server-managed grant rather than widening a role globally.
- Files: `api/Auth/CompetitionAccessAttribute.cs`, `api/Auth/Roles.cs`, organiser controller actions and frontend organiser controls.
- Source: AI Control Centre security-review chat, 15 October 2026.

## 2026-10-16: Live video through the Cloudflare Realtime SFU
- Why: organisers want to broadcast the arena from a phone to 50–200 spectators with under a second of delay; a phone can't upload a copy per viewer.
- Rule: the API alone talks to Cloudflare (`Streaming:Cloudflare:*`), so no browser ever sees the app token or SFU session ids. Broadcasters (admins, and the trainer who created the competition, via `[CompetitionAccess]`) publish over HTTP in two phases (`POST` then `/ready`); spectators negotiate anonymously over the live hub (`WatchStream`/`AnswerStream`) with opaque watch ids, a global session cap, a token bucket and a per-connection limit.
- Overlays (now-racing strip, announcements, Back soon, viewer count, and later score cards and admin banners) are drawn by the app over the video, never burned into it.
- Rejected: Cloudflare Stream WHIP/WHEP (about $1 per 1,000 viewer-minutes and no viewer counts); a phone-to-phone mesh over SignalR (a phone's upload can't serve every viewer); YouTube Live (can't broadcast from our site); LiveKit Cloud (free plan too small for 200 viewers).
- Not yet: recording and replays (the client's decision), Nest or RTMP cameras, a player that floats across pages.
- Files: `docs/specs/live-stream.md`, `api/Controllers/StreamsController.cs`, `api/Services/Streaming/`, `api/Hubs/LiveHub.cs`, `web/src/live/stream*.ts`, `web/src/components/stream/`.
- Source: live stream chat in the AI Control Centre, 16 October 2026.
