---
name: mg-growth-and-scalability-audit
description: Concurrency capacity modelling, database scaling (SQLite vs Neon Postgres), SignalR fan-out limits, EF Core N+1 query detection, showground shared-NAT rate-limit analysis, and multi-event growth architecture audit skill for the Mounted Games App.
---

# Mounted Games App — Growth, Scalability & Capacity Modelling Audit Skill

Use this skill for the **Growth, Scalability & Load Capacity Parent Agent (Parent #8)**.

## Mission
Answer with concrete engineering maths and code evidence:
1. **How many concurrent users, live competitions, simultaneous ring scorers, and livestream viewers can the current architecture handle today?**
2. **What is the very first bottleneck that will break at 100, 500, 2,500, and 10,000 concurrent users?**
3. **What architectural and product levers will let the platform scale across clubs, national associations, and international championships?**

---

## Multi-Agent Architecture (Parent → 3 Specialist Scalability & Growth Subagents)

The **Growth & Scalability Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent GS1 — Database Concurrency, EF Core Query Efficiency & Storage Scaling (`api/Data/`, `api/Controllers/`, `api/Services/`)
1. **SQLite vs Neon Postgres Concurrency Limits:**
   - Analyse write locking under concurrent race scoring, chat messages, entry signups, and background workers (`NotificationScheduler`, `StreamSweeper`).
   - Check Neon Postgres connection pooling, transaction lifetimes, and `DbContext` scoping across controllers and background `IHostedService` loops.
2. **N+1 Queries, Unbounded `.ToListAsync()` & Missing Indexes:**
   - Audit every hot endpoint (`/api/competitions`, `/api/competitions/{id}`, `/api/stats`, `/api/seasons`, `/api/entries`, `/api/announcements`, `ScoringService`) for N+1 queries, missing `.AsNoTracking()` on read-only endpoints, full-table scans on JSON columns (`SectionConfigJson`, `PlannedFinalRacesJson`), or unindexed foreign keys.
3. **Multi-Season Data Growth:**
   - What happens when the database has 500 past competitions, 50,000 races, and 10,000 riders? Which queries degrade `O(N)` or `O(N²)` over time?

### Subagent GS2 — SignalR `LiveHub` Fan-Out, Rate Limiting Under Showground Carrier-Grade NAT & Memory Footprint
1. **SignalR `LiveHub` Fan-Out & Single-Instance vs Multi-Instance Scaling:**
   - Calculate memory and CPU per connected WebSocket client on `LiveHub`.
   - What happens when 2,000 spectators are watching Finals in `competition:{id}` and every lane tap triggers a broadcast + client refetch? Does `RaceScored` cause a **thundering herd** where 2,000 clients simultaneously hit `GET /api/competitions/{id}` at the exact same millisecond?
   - What happens if the API scales horizontally to 2+ instances without a Redis backplane?
2. **Rate Limiting vs Showground Shared IP (Carrier-Grade NAT / StarLink Wi-Fi):**
   - Inspect the IP rate limiters in `api/Program.cs` (`auth`, `write`, `public`).
   - At a competition where 300 users are on the same venue StarLink Wi-Fi or the same mobile carrier NAT gateway IP, will the per-IP rate limiter accidentally block the entire showground or lock out the ring scorers?
3. **In-Memory State & Background Services:**
   - Audit in-memory caches, `NotificationScheduler`, `StreamSweeper`, and Cloudflare SFU session tracking for memory leaks or duplicate execution across instances.

### Subagent GS3 — Product Growth Loops, Viral Sharing, Multi-Region/Association Readiness & Onboarding Funnel
1. **Viral & Spectator Growth Loops (`https://mounted-games-app.vercel.app` & `web/src/`):**
   - Audit how competitions, live results, podiums, instant replays, and invite links share on WhatsApp/Instagram/Facebook (OpenGraph `<meta>` tags, deep links, `/embed/` embeds, QR codes, public season pages).
2. **Club & Organiser Self-Serve Onboarding Funnel:**
   - Trace the friction from a new club/organiser discovering the site → requesting/creating an organiser account → creating their first competition in the 10-step wizard → inviting trainers and parents.
3. **Capacity Table & Scaling Roadmap:**
   - Produce a concrete **Capacity Matrix** estimating safe concurrent users today (Single-Node SQLite vs Single-Node Neon Postgres vs Scaled Multi-Node) and ranked engineering fixes (`Quick Wins < 1 day`, `Medium 1–3 days`, `High-Scale Architecture`).

---

## Required Output Format
1. **Executive Capacity Estimate Table:**
   - Concurrent Spectators (Live Standings)
   - Concurrent Simultaneous Ring Scorers
   - Concurrent Live Streams (Cloudflare SFU + API control plane)
   - Concurrent Entry Signups / Checkout spikes (when entries open at 8:00pm)
2. **Thundering Herd & Bottleneck Findings** (ranked `CRITICAL` → `LOW` with exact `[File.cs](file:///...)` links and maths).
3. **Showground NAT / Rate-Limit Safety Analysis**.
4. **Product & Viral Growth Recommendations**.
