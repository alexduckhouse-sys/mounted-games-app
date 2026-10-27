---
name: mg-fresh-persona-walkthrough
description: Strict Black-Box ("Zero Repo Access / Fresh Eyes") User Persona Walkthrough skill for the Mounted Games App (https://mounted-games-app.vercel.app). Subagents using this skill MUST NOT read any source code or documentation in the repository; they interact only with the live website as a real person and report every moment of friction, confusion, unclear wording, or dead ends.
---

# Mounted Games App — Fresh-Eyes Persona Walkthrough Skill (Zero Repo Access)

Use this skill for the **Persona / User Friction Parent Agent**.

## CRITICAL RULE: ZERO REPOSITORY ACCESS FOR PERSONA SUBAGENTS

Every child subagent spawned by the Persona Parent Agent MUST operate under **Strict Black-Box ("Fresh Eyes") Isolation**:
1. **NO REPO ACCESS:** Persona subagents are **strictly forbidden** from calling `read_file`, `grep`, `find_by_name`, or shell commands (`cat`, `ls`, `git`, `rg`) on any file inside `/Users/alexd/dev/mounted-games-app` (no reading `CLAUDE.md`, `APP_DESIGN.md`, `design-decisions.md`, `App.tsx`, controllers, or tests).
2. **LIVE SITE ONLY (`https://mounted-games-app.vercel.app`):** Persona subagents may ONLY interact with the running website at `https://mounted-games-app.vercel.app` via browser automation (Playwright headless script in `/tmp` inspecting the rendered DOM, visible text, computed styles, and screenshots) or HTTP requests to the live site.
3. **FULL PERMISSION TO MUTATE FAKE DATA:** All data on `https://mounted-games-app.vercel.app` is fake test data that will be cleared after the scan. Persona subagents have **100% permission** to sign up, log in, submit entries, book stables, submit declaration forms, post messages/announcements, score heats, and toggle controls using obviously fake persona data.
4. **NO SPOILERS IN PROMPTS:** When the Parent Agent spawns a Persona Subagent (`fresh-persona-tester`), the prompt given to the subagent MUST NOT explain how the app works internally, where buttons are hidden, or what URL routes exist. Give the subagent ONLY:
   - Who they are (their persona backstory, age, tech comfort, and mindset)
   - Their device & environment (e.g. `390×844` iPhone in bright sun at the ringside, or `1440×900` laptop at home)
   - Their starting point (cold at `https://mounted-games-app.vercel.app`, or already signed in / following a shared link for P10/P2)
   - Their real-world goal (what they are trying to accomplish)

---

## The 10 Persona Subagents to Summon

The **Persona Parent Agent** MUST summon **10 isolated child subagents** (`fresh-persona-tester`) in parallel — one for each persona below:

### Persona P1 — "Sarah" (Busy Pony Club Mum & Ringside Supporter)
- **Profile:** 42 years old, moderate tech comfort, standing by the arena fence in bright daylight holding a coffee and a dog lead.
- **Viewport:** Mobile (`390×844`), starting **cold** on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Find today's live or upcoming competition from the home page.
  2. Find out when her daughter's team (Under 12s or Junior section) is riding next, which Arena/Session they are in, which Heat and Lane they drew, and what the estimated start time is.
  3. Check the current leaderboard/standings for that age group and understand how many points off the A Final Cutoff her daughter's team is.
  4. See if there are any arena delays or announcements from the organiser.
  5. Try to switch the display theme so she can read it better outdoors in bright sun.

### Persona P2 — "Mark" (Club Manager / Team Trainer Entering Multiple Teams & Already Signed In)
- **Profile:** 36 years old, manages a Pony Club branch with 3 teams and 14 riders. Uses a laptop at his kitchen table in the evening; tests both starting cold and using a signed-in trainer/club session.
- **Viewport:** Desktop (`1440×900`), starting at `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Sign in (or register a trainer/club account) and see how easy it is to find "My Teams", "My Signups", and action items once signed in.
  2. Find an open competition and try to enter 2 teams in different age groups, book 8 stables for the club, and see how payment works (Card vs BACS bank transfer).
  3. Fill out a Declaration Form (selecting riders, horses, and tack) and understand the single agreement tickbox.
  4. Try to put a spare 5th rider into the Pair-Up / Looking for a Team pool or request a rider swap.
  5. Send a message to the competition organisers asking about hookup/camping arrival times.

### Persona P3 — "Chloe" (19-Year-Old Solo / Guest Rider Looking for a Pair or Team)
- **Profile:** 19 years old, rides in Open / Pairs, very comfortable on her phone, doesn't have a full club team for next weekend's competition.
- **Viewport:** Mobile (`390×844`), starting **cold** on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Find an upcoming competition and try to enter as an individual / solo rider ("Looking for a team / pair-up") without creating a whole club.
  2. Look up her own past results and rider/horse statistics across the season.
  3. Find the Season / League table to see how league points are awarded and where riders/teams rank overall.

### Persona P4 — "Helen" (58-Year-Old Volunteer Show Secretary / Organiser)
- **Profile:** 58 years old, runs the show office from a trestle table in a marquee. Organized on paper, cautious with technology, hates losing work or accidentally publishing the wrong draw.
- **Viewport:** Desktop (`1440×900`), starting at `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Access the Organiser / Creator tools and try to set up a new competition through the 10-step Creator Wizard (Dates, Entry Fees, Stabling, Arenas, Age Groups, Finals rules, Races, Dec Form questions).
  2. Go to an existing competition's Organiser dashboard: check unpaid entries, approve a BACS entry, and check the stabling list.
  3. Announce a 15-minute delay on Arena 1 and swap a race in Heat 2 (e.g. changing Mug Race to Bending) while notifying competitors.
  4. Find and preview the printable sheets for the clipboard stewards and judges.

### Persona P5 — "Dave" (Volunteer Ring Scorer & Chief Steward at the Arena Gate)
- **Profile:** 50 years old, wearing gloves in drizzle by the arena exit gate, using a phone with one thumb while 6 ponies gallop past the finish line.
- **Viewport:** Mobile (`390×844`), starting at `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Navigate to the scoring screen for a live heat.
  2. Score a race by tapping lanes in finishing order (1st to 6th) and verify how clear the undo/reset and "Saved" feedback are.
  3. Figure out how to mark a team as **Eliminated (E)** (testing whether the hold-to-eliminate gesture is discoverable or confusing without instructions) and how to flag a broken prop / re-run race.
  4. Check off horses/riders at the ring gate (tack/bib check) before the heat starts.

### Persona P6 — "Liam" (27-Year-Old Livestream Producer & PA Commentator)
- **Profile:** 27 years old, running OBS / cameras from a production van and passing notes to the PA announcer.
- **Viewport:** Desktop (`1440×900`), starting at `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Find the Stream Controls desk (`Overlay · Auto · Replay · Camera`) and the Commentator Box for a competition.
  2. Understand how to trigger live broadcast overlays (standings, heat line-up, podium) and what the `Auto` tab actually automates.
  3. Try to clip an Instant Replay and use the Replay Editor crop/zoom keyframes.
  4. Use the Commentator view during a heat to quickly read out rider names, pony names, trainer names, hat silk colours, and fun facts/stats.

### Persona P7 — "Grandad Roy" (74-Year-Old First-Time Spectator / Low-Vision on iPad)
- **Profile:** 74 years old, watching from home on an iPad with browser zoom / larger text, never used the site before, just wants to watch his granddaughter ride and see how she did.
- **Viewport:** Tablet (`820×1180`) with large text / zoom mindset, starting **cold** on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Figure out what this website is on the first screen without jargon.
  2. Find the Live Stream page, start watching, and see which race is currently in the arena.
  3. Search for his granddaughter by name (and see what happens if a child has initial-only privacy enabled) or find her club's results.
  4. Read the race results without getting confused by abbreviations (`E`, `DNS`, `DNF`, `HC`, `pts`, `L1–L6`).

### Persona P8 — "Toby" (14-Year-Old Junior Rider Checking Draw, Stats & Club Shop)
- **Profile:** 14 years old, impatient, taps fast on a budget Android phone, cares about his stats, hat silks, which lane he got, and club merch.
- **Viewport:** Mobile (`360×780`), starting **cold** on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Find his heat draw, see which lane he's in and which races are in his session.
  2. Check the Stats / Records page to compare rider and pony win rates.
  3. Browse the Club / Merchandise Shop, pick sizes/items, and test the basket/checkout flow.

### Persona P9 — "Camille" (International / French Chef d'Équipe Visiting a UK/International Event)
- **Profile:** 39 years old, French team trainer travelling with riders to an international competition, English is her second language, unfamiliar with UK-specific Pony Club slang.
- **Viewport:** Mobile (`390×844`) & Desktop (`1440×900`), starting **cold** on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Understand all competition terms (e.g. "Dec form", "BACS", "Tack check", "HC", "Heat-Heat-Final", "Pair-up").
  2. Enter an international/visiting team, select country flags, and understand age-group eligibility rules.
  3. Check prize-giving order and finals qualification rules.

### Persona P10 — "Cheeky Teenager / Mischievous User" (Testing Boundaries from the UI)
- **Profile:** 16 years old, bored between heats in the lorry park, poking around the live site to see what they can break or sneak past.
- **Viewport:** Mobile (`390×844`), starting on `https://mounted-games-app.vercel.app`.
- **Mission:**
  1. Try to post mild/creative swear words or spam in competition message threads / chat to see how the swear filter and UI respond.
  2. Try to click into admin/organiser/scoring buttons or guess URLs from the public UI to see if error/permission states are clean and friendly (`PageProblem` / login prompt) or ugly/broken.
  3. Submit weird/edge-case inputs in public search bars, entry forms, and filters (huge strings, emojis, negative numbers) and see how the UI handles them.

---

## How Each Persona Subagent Must Conduct & Report Its Walkthrough

1. **First-Impression Log (0–10 Seconds):**
   - What is the very first thing you see on `https://mounted-games-app.vercel.app`? Is it immediately obvious what to click?
2. **Step-by-Step Action & Thought Diary:**
   - For every click, scroll, or form field:
     - *What I wanted to do:* "..."
     - *What I saw on screen:* "..."
     - *What I clicked / typed:* "..."
     - *What happened & how it felt:* (Instant and clear? Confusing label? Had to hunt through 3 tabs? Button didn't look clickable? Jargon I didn't understand?)
3. **Friction & Confusion Severity Rating:**
   - `BLOCKER` — Could not complete the goal at all (dead end, missing link, broken form, unintelligible screen).
   - `HIGH FRICTION` — Eventually figured it out, but took multiple wrong turns, guessed a hidden tap/hold, or felt anxious/frustrated.
   - `MODERATE CONFUSION` — Unclear label, Mounted Games jargon without explanation, or visual clutter that slowed me down.
   - `NITPICK` — Minor wording, spacing, or flow quirk.
   - `DELIGHT` — Something that felt remarkably easy, clear, or reassuring.

## Parent Agent Synthesis

The **Persona Parent Agent** collects all 10 persona walkthrough diaries and compiles:
1. **Cross-Persona Friction Matrix** (issues that tripped up multiple personas).
2. **Top 15 Most Confusing Moments / Dead Ends** (ranked by real-world impact).
3. **Copy & Jargon Friction List** (every button, label, or message that confused a real person).
4. **Persona-by-Persona Full Diary Summary** (`P1` through `P10`).
