---
name: mg-dead-code-and-duplication-audit
description: Dead code, orphaned files/components, unused CSS classes, duplicate frontend/backend helpers, pointless wrappers, and tech-debt cleanup audit skill for the Mounted Games App.
---

# Mounted Games App — Dead Code, Pointless Code & Duplication Audit Skill

Use this skill for **Parent Agent #12 (`dead-code-duplication-parent`)** and for Claude/Codex cross-checks.

## Mission
After 192 fast-moving PRs and multiple page redesigns, hunt down every piece of **dead code, orphaned component/helper, unused CSS selector, duplicate implementation, pointless wrapper, and stale leftover** across `web/` and `api/` so the codebase stays lean, fast, and maintainable.

---

## Multi-Agent Architecture (Parent → 3 Specialist Code-Hygiene Subagents)

The **Dead Code & Duplication Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent DC1 — Orphaned Frontend Files, Components, Hooks, Libs & Dead Exports (`web/src/`)
1. **Unreferenced `.tsx` / `.ts` Files & Exports:**
   - Scan every file in `web/src/components/`, `web/src/hooks/`, `web/src/lib/`, `web/src/pages/`, `web/src/offline/`, `web/src/live/`, and `web/src/weather/`.
   - Identify any file, component, or exported function/type that is **only imported by its own `.test.ts(x)` file** (or not imported anywhere at all in production code)!
2. **Duplicate UI Kit Primitives (Old vs New Kit):**
   - Check overlapping components created across different waves: e.g. `Sheet.tsx` vs `BottomSheet.tsx` vs `FormSheet`/`PickSheet`, `ConfirmDialog.tsx` vs `ConfirmPopup.tsx`, `BibBadge.tsx` vs `BibSwatch.tsx`, old dashboard/admin components, or duplicate icon/silk helpers.
   - Recommend which ones can be unified or deleted cleanly.

### Subagent DC2 — Dead CSS Classes, Unused Tokens & Redundant Stylesheets (`web/src/**/*.css`)
1. **Unused CSS Selector Audit:**
   - Inspect `web/src/index.css`, `web/src/theme/skin.css`, `web/src/theme/kit.css`, `web/src/components/eventPages.css`, `web/src/components/sitePages.css`, `web/src/pages/clubShop/clubShop.css`, `web/src/pages/admin/creator/wizard.css`, `web/src/pages/competition/streamControls/streamControls.css`, `web/src/pages/competition/timetable.css`, and `web/src/pages/competition/announcements.css`.
   - Find CSS classes and `--mg-*` variables defined in stylesheets that are never referenced in any `.tsx`/`.ts` file.
2. **Duplicate / Conflicting CSS Rules:**
   - Identify duplicated card, pill, row, button, or sheet styles across multiple `.css` files that could be consolidated into `kit.css` or `skin.css`.

### Subagent DC3 — Backend (`api/`) Dead Code, Duplicate Services/DTOs & Pointless Complexity
1. **Unused Backend Services, Methods, DTOs & Entities (`api/`):**
   - Scan `api/Controllers/`, `api/Services/`, `api/Dtos/`, `api/Entities/`, and `api/Security/` for unused DTO records, dead controller actions, unreferenced service methods, stale template files (like `api/MountedGames.Api.http`), or redundant mapping logic.
2. **Frontend↔Backend Duplicate Logic & Pointless Wrappers:**
   - Hunt for over-engineered pass-through functions, stale `TODO`/`FIXME` comments, dead feature flags, or duplicated business logic inside `api/` and `web/src/`.

---

## Required Output Format
1. **Safe-to-Delete Files & Tests List** (files only imported by their own tests or nowhere at all, with verification proof).
2. **Duplicate Components & Helpers Consolidation Table** (`Keep X` ← `Replace & Delete Y`, with exact file links).
3. **Dead CSS Selectors & Stylesheet Cleanup List**.
4. **Backend (`api/`) Dead Code & Simplification List**.
