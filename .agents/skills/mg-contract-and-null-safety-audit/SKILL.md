---
name: mg-contract-and-null-safety-audit
description: C# API DTO (ApiDtos.cs / CommerceDtos.cs / StatsDtos.cs) vs TypeScript (web/src/types.ts) contract parity, enum alignment, SignalR payload matching, and runtime null/undefined safety in untested web/src/pages/** files.
---

# Mounted Games App — C#↔TypeScript Contract Parity & Runtime Null-Safety Audit Skill

Use this skill for **Parent Agent #17 (`contract-nullsafety-parent`)**.

## Mission
Because frontend unit tests mock `../api` and `web/vitest.config.ts` excludes `src/pages/**` from the 97% coverage gate, this audit hunts down:
1. **C# DTO ↔ TypeScript Type Drift:** Any mismatch in property names, nullability, nested structures, or enum numeric values between `api/Dtos/*.cs` and `web/src/types.ts` (and `pages/**/*Types.ts`).
2. **SignalR Hub Event Name & Payload Drift:** Any mismatch between `api/Hubs/` (`LiveBroadcaster.cs`) and `web/src/live/useLiveHub.ts`.
3. **Runtime Null/Undefined Crashes in `web/src/pages/**`:** Places where a page component assumes an optional array, object, or JSON field is non-null and crashes (`TypeError: Cannot read properties of undefined/null`) on a fresh or partially configured competition.

---

## Multi-Agent Architecture (Parent → 3 Specialist Contract & Null-Safety Subagents)

### Subagent CN1 — C# DTOs (`api/Dtos/*.cs`, `Mappings.cs`) vs TypeScript Types (`web/src/types.ts`, `*Types.ts`)
1. Compare every C# record in `api/Dtos/ApiDtos.cs`, `api/Dtos/CommerceDtos.cs`, `api/Dtos/StatsDtos.cs`, and `api/Auth/AuthDtos.cs` against `web/src/types.ts` and feature `*Types.ts` files.
2. Check every C# enum (`api/Entities/`) against TypeScript numeric enum assumptions.
3. Check `api/Hubs/LiveBroadcaster.cs` event names and argument shapes against `web/src/live/useLiveHub.ts`.

### Subagent CN2 — Runtime Null/Undefined Safety in Public, Competition, Scoring & Stream Pages (`web/src/pages/competition/`, `seasons/`, `stats/`, `embed/`)
1. Inspect every `.tsx` file in `web/src/pages/competition/`, `seasons/`, `stats/`, and `embed/` for unsafe `.map()`, `.filter()`, `.length`, destructuring, or property access on nullable/optional API fields, malformed `localStorage` data, or empty competition states.

### Subagent CN3 — Runtime Null/Undefined Safety in Organiser, Creator, Admin, Club Shop & Profile Pages (`web/src/pages/operations/`, `admin/`, `commerce/`, `clubShop/`, `profile/`)
1. Inspect every `.tsx` file in `web/src/pages/operations/`, `admin/`, `commerce/`, `clubShop/`, and `profile/` for runtime crash risks, missing loading/error guards, or stale mock assumptions in tests.
