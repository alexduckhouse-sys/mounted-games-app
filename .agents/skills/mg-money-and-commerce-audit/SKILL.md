---
name: mg-money-and-commerce-audit
description: Entry fees, stabling maths, BACS references, Club Shop pricing/variants/stock concurrency, seller payouts, floating-point rounding, and currency formatting audit skill for the Mounted Games App.
---

# Mounted Games App — Money, Entry Fees, Club Shop & Financial Maths Audit Skill

Use this skill for **Parent Agent #15 (`money-commerce-parent`)**.

## Mission
Ensure every penny/cent of financial calculation across Competition Entries, Stabling, Club Shop orders, and Seller Payouts is mathematically exact, race-condition safe, and clearly presented.

---

## Multi-Agent Architecture (Parent → 3 Specialist Financial & Commerce Subagents)

### Subagent MC1 — Competition Entry Fees, Team vs Individual Pricing, Stabling Maths & BACS (`api/` & `web/src/`)
1. Trace fee calculations from the 10-step Creator Wizard (`Money`, `Stabling`) → `Competition` entity → `EntryPage.tsx` / `EntryForm.tsx` → Organiser `EntriesPage.tsx` → `MySignupsPage.tsx`.
2. Check team fee + individual rider fee + stabling (`number of stables × unit price`) + late fees. Do the frontend preview total and backend persisted total always match to the penny?
3. Check BACS bank details, payment references, and manual "Mark as Paid" flows.

### Subagent MC2 — Club Shop, Seller Catalogue, Variants, Stock Concurrency & Orders (`CommerceController.cs`, `CommerceOrderService.cs`, `web/src/pages/commerce/`, `clubShop/`)
1. Audit `CommerceOrderService.cs`, `CommerceController.cs`, `SellerCataloguePage.tsx`, `CommerceOrdersPage.tsx`, `CommerceManagementPage.tsx`, and `EventShopPage.tsx` (including PR #187 & #188 shop item details).
2. Check for floating-point rounding bugs (`double`/`float` vs `decimal`/integer minor units), negative quantity or zero/negative price validation, stock decrement race conditions when two users buy the last item simultaneously, and deleted/edited item handling on existing orders.

### Subagent MC3 — Seller Payouts (`PayoutsPage.tsx`), Refunds Policy & Multi-Currency / Formatting Consistency
1. Audit `PayoutsPage.tsx`, `web/src/lib/payouts.ts`, `commerceFormat.ts`, and API payout endpoints.
2. Verify currency symbol formatting (`£` / `GBP` vs international competitions) so prices never show `£NaN`, `£undefined`, or raw unformatted floats like `£12.5`.
