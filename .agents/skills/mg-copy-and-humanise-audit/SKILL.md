---
name: mg-copy-and-humanise-audit
description: UK English spelling, humanise natural copywriting, developer-jargon removal, error message friendliness, and transactional/custom email template audit skill for the Mounted Games App.
---

# Mounted Games App — UK English, Humanise Copywriting & Email Audit Skill

Use this skill for **Parent Agent #14 (`copy-humanise-parent`)**.

## Mission
Enforce the `AGENTS.md` and `humanise` rules across every user-facing string in `web/src/` and `api/`:
1. **100% UK English:** Catch every US spelling (`color`, `organize`, `organizer`, `center`, `catalog`, `favorite`, `canceled`, `unauthorized`, `license` as noun, `program` for event programme) in visible UI text, emails, and legal pages (never changing CSS/JS identifiers, only visible text).
2. **Natural Human Wording (`humanise`):** Replace stiff, robotic, AI-sounding, or developer-jargon phrasing (`"Invalid payload"`, `"Entity not found"`, `"Mutation failed"`, `"No records configured"`) with warm, concise, plain human language.
3. **Email Templates & Links (`api/Services/` Email/Invite/Notification templates):** Verify every email sent by the platform reads naturally and links to valid production routes.

---

## Multi-Agent Architecture (Parent → 3 Specialist Copy & Email Subagents)

### Subagent CH1 — Public, Competitor & Signed-In UI Copy + US Spelling Sweep (`web/src/`)
1. Scan all `.tsx` and `.ts` files in `web/src/pages/` and `web/src/components/` for US English spellings in visible strings, labels, placeholders, aria-labels, and titles.
2. Audit empty states, confirmation dialogs (`ConfirmDialog`), `PageProblem` messages, and `Toast` notifications for natural, human phrasing (`humanise`).

### Subagent CH2 — Organiser, Creator Wizard, Scoring, Stream Desk & Admin Copy (`web/src/pages/admin/`, `operations/`, `streamControls/`)
1. Audit the 10-step Creator Wizard, Organiser pages, Full-Screen Phone Scoring, Stream Controls, and Site Admin pages for jargon, unclear labels, robotic helper text, or inconsistent capitalisation.

### Subagent CH3 — Backend Error Messages, Validation Responses, Push Notification Text & Email Templates (`api/`)
1. Audit every `BadRequest("...")`, `Conflict("...")`, `Forbid()`, `NotFound("...")`, push notification payload (`NotificationScheduler`), and email template (`EmailService`, `AccountInvite`, custom emails, confirm-email, unsubscribe) across `api/Controllers/` and `api/Services/`.
2. Verify all links inside emails and push notifications resolve to real routes on `https://mounted-games-app.vercel.app`.
