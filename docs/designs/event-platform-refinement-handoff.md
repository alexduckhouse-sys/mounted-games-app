# MG App · Event platform refinement — implementation handoff

This handoff refines the screens that were rejected. It keeps the existing direction: navy `#17385f`, red `#c8102e` used only for LIVE and destructive actions, Barlow for body text and Barlow Condensed for headings, pale grey ground, subtle borders. There are no new visual styles, no new API fields, no shipping, no payouts and no sizes. Existing permissions and reduced-motion behaviour stay as they are.

Preview: `event-platform-refinement.html` (static, self-contained apart from Google Fonts). The source is the Claude Design canvas *MG App · Event platform*, rows "Event shop, sellers & demo checkout", "Season & documents" and "Organiser".

## Implementation boundaries

This is a visual reference exported from Claude Design. The working API and the user’s agreed behaviour take precedence over examples in the mock-up:

- Fake card fields remain editable, with obvious test details and a clear demo notice. Card details stay in component memory and are never posted or stored. The requested WhiteLabel payment animation remains.
- A cancelled payment can belong to an existing unpaid order. The interface describes the actual order state; it must not claim that no order exists.
- Real/manual orders can appear alongside demo orders. Each demo receipt stays clearly marked.
- Seller names and collection-note fields are not added to the API for this refinement. Product categories use the existing supported categories.
- Season tables retain published snapshots. Changes to rules require a fresh publication; settings do not silently rewrite history. Each season has one configured division, with existing shared-place tie handling.
- Readiness checks are advisory. The implementation does not invent a publish gate, checklist export or draw undo endpoint. Draw previews keep the existing stale-preview protection.
- Dedicated editing views are used where a full form would make a phone sheet cramped. Existing navigation and permission controls remain available.

## What changed and why

| Problem raised | Rule applied |
|---|---|
| Too many nested cards | One level only. Content sits in full-width **lists** (`.list` and `.row`). Cards are not placed inside cards. |
| Giant forms above useful content | Infrequent edits open as a **bottom sheet** or an inline `<details>` row. Primary content always comes first. |
| Repeated status pills | Status is **coloured text** in the row's trailing slot (`.st ok / warn / bad / mut`). Pills are kept only for the yellow `DEMO` chip, and that appears once per screen title. |
| Verbose copy | One-line notes (`.note`, 13 px). No explanatory paragraphs inside lists. |

## Shared building blocks (map to existing components)

- **Header** (`.hd`): a 44 px top row (back, context, overflow ⋯), then the title. Optional underline **tabs** (`.tab[aria-current]`).
- **Row** (`.row`): minimum height 56 px. Leading thumb or number, two-line text block, trailing price, status or action. Every tap target is at least 44 × 44.
- **Section label** (`.sec`): 12 px uppercase, with an optional right-hand meta label in sentence case.
- **Sticky footer** (`.foot`): the single primary action for the screen, sitting on white above the content.
- **Sheet** (`.sheet` + `.scrim`): a modal dialog (`role="dialog" aria-modal="true"`). It returns focus to whatever opened it.
- **Qty stepper** (`.qty`): − / output / +. Each button's `aria-label` names the item. The output uses `aria-live="polite"`.
- **DEMO chip** (`.demo`): yellow `#ffe27a` with text `#3a2a00`. Use it in titles only.

The tokens and classes are in the preview's `<style>` block. Reuse them as-is or map them onto the app's existing equivalents.

## Screens

### Event shop
- Category tabs sit under the title (All, Programmes, Clothing, Tack & kit, Food, Raffle). An empty category keeps its existing empty state.
- Items are **grouped by seller**: "From the organiser", then one section per approved seller with "Approved seller" as meta text. This replaces per-row badges.
- Row action: **Add**. Once an item is in the basket, the button becomes the qty stepper.
- **Sticky basket summary**: item count, "Collect at event", total, **Review**. Hide it when the basket is empty.
- The collection point appears once, as a note under the header.
- The T-shirt size note has been removed (no sizes).

### Demo checkout (focused flow, no tab bar)
1. **Review**: lines with qty steppers, total, collection note. Button: *Continue to payment*.
2. **Payment**: fake card details are prefilled and **read-only** (`4242 4242 4242 4242`, `12 / 30`, `123`, `Demo Buyer`). Nothing is sent anywhere; the fields are display only, with no PAN handling. A **Demo result** toggle (Approve / Decline) sets the outcome. Buttons: *Pay £17.00* (padlock icon) and *Cancel*.
3. **Processing**: a padlock whose shackle closes, with a spinning ring, inside `role="status" aria-live="polite"`. Under `prefers-reduced-motion: reduce`, both animations stop and the static padlock and text remain. Hold this screen for about 1.2 s.
4. **Confirmed**: reference (`DEMO-0042`), amount, time, lines, the collection instruction. Buttons: *View receipt* and *Shop*.
5. **Declined**: `role="alert"`, "Nothing was charged. Basket kept." Buttons: *Try again* (back to Payment) and *Back to shop*.
6. **Cancelled**: "No order placed". The basket stays on the device.

Every screen in the flow carries the `DEMO` chip in its title. There are no step indicators and no full-width banners.

### Orders and receipts
- **Your orders**: a single section header, "Demo orders · Test payments only", covers the whole list. **Rows carry no per-order banners or chips.** Each row shows reference, event and date, amount, and status text (Paid / Refunded / Declined).
- **Receipt**: a status, time and card (`Demo •••• 4242`) summary, then items, total and the collection note.
- **Refund** (organisers only, under a collapsed "Organiser actions"): a confirmation sheet, "Refund £17.00?" It refunds the whole order (the demo has no partial refunds). The red destructive button reads *Refund £17.00*. Afterwards the order shows **Refunded** to the buyer.
- Only render organiser actions when the current role allows it. This is the existing permission check, unchanged.

### Seller catalogue
- Compact rows: name, price, and a one-line event summary that is coloured only when it matters ("1 pending", "Declined at 1 event"). Drafts show "Draft · not offered".
- **+ Add item** is in the header. It opens a **bottom sheet** with Name, Price and Category, plus the optional *Collection note* behind "+ Collection note". Buttons: *Save draft* and *Save and choose events*.
- **Item screen**: event selection is **per item** and there is no global competition picker.
  - A summary row (price, category, note) leads to Edit.
  - "Events for this item" shows one row per event, with Approved, Pending or Declined as status text. A declined row expands to show the organiser's reason.
  - "Offer at another event" is a collapsible list of events currently accepting sellers, each with a *Request* button. Closed events are not listed.
  - One note: changing the price sends approved events back to Pending.

### Season (standings first)
- The header has the season name and three tabs: **Standings** (default), **Rounds**, **Settings**.
- **Standings**: two compact selects (age, format), then the table (Pos, Team, Rds, Pts). Tied positions show as `=3`. A single footnote covers best N, shared places, the "after round" date and "not an official ranking".
- **Rounds**: a numbered list with date and status text (Final, Provisional, LIVE in red, Upcoming).
- **Settings** (organisers only, labelled as such): collapsible summary rows for Sections, Place points (expanded in the mock, including *Did not finish / eliminated*), Results that count (best N) and Ties. A sticky "1 unsaved change · Discard · Save" bar appears only when something is dirty. Saving recalculates the tables from published results, as before.

### Team history
- One summary line under the name (place, points, best N of rounds) replaces the three stat tiles. The star (follow on this device) is in the header.
- The rounds table shows dropped results with a struck-through points value and "dropped" in the sub-line. Rounds not entered show "—".

### Organiser tools
- **Readiness (phone)**: the status is a single header line. Rows are grouped under "Blocking publish" and "Before the day", with counts right-aligned and red reserved for blockers. Payments refresh failures show inline with *Retry*. Completed checks collapse under "Done". *Recheck* and *Export checklist* move to the ⋯ menu. Sticky button: *Fix 2 clashes*.
- **Draw preview**:
  - A seed row with *New seed*.
  - Fairness is one collapsible row ("1 to check · 2 passed") that expands to the failing check.
  - Round 1–3 segmented control, with heats as lane-numbered lists.
  - Lane spread is collapsed by default, and draw settings live in ⋯.
  - Sticky *Discard* / *Apply draw*. After applying, show a toast saying "Draw applied · Undo", with the existing undo behaviour.
- **Desk (desktop)**: issue rows are grouped under section header rows (Arena clashes / Declarations / Payments / Teams). This removes the per-row type pills. Only the clash tile keeps its "Blocks publish" tag.

## Behaviour and accessibility checklist
- [ ] All targets are ≥ 44 px. Tabs use `aria-current` (navigation) or `role="tab"` + `aria-selected` (in-page filter).
- [ ] Sheets trap focus, close with Esc and the close button, and return focus.
- [ ] `<details>` disclosures, or an equivalent `aria-expanded` button, for every collapsible row.
- [ ] The processing animation honours `prefers-reduced-motion`, and so does any app-level reduced-motion setting already in place.
- [ ] Status is never conveyed by colour alone. The word is always present.
- [ ] Prices use `font-variant-numeric: tabular-nums`.
- [ ] No new API fields. The card fields are client-side display only, and the demo outcome toggle is local state.

## Out of scope
Shipping, payouts, sizes and variants, partial refunds, and real card capture. The Following, timetable and live layouts are unchanged.
