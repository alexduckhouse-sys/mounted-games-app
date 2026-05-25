namespace MountedGames.Api.Services;

/// <summary>
/// Per-race overrides applied to built-in <c>RaceTemplate</c> rows on every API
/// startup. Used to push canonical rule text / diagram refinements to existing
/// databases without manual admin work.
///
/// Source: <c>docs/pc-mounted-games-race-rules-2026.md</c> (Pony Club Mounted
/// Games Race Rules 2026). Fields set to <c>null</c> here keep the existing
/// value in the DB — only the non-null overrides apply.
///
/// Long term this will cover every built-in race; for now it holds the most
/// frequently-run ones plus the JV variants that previously inherited senior
/// rule text.
/// </summary>
internal static class RaceLibraryUpdates
{
    public record Entry(string? Summary = null, string? Rules = null,
                        string? DiagramJson = null, string? Category = null);

    public static readonly Dictionary<string, Entry> ByName = new(StringComparer.OrdinalIgnoreCase)
    {
        // ── Bending family ─────────────────────────────────────────────────
        ["Bending"] = new Entry(
            Summary: "Each rider in turn weaves down and back through five bending poles, hands the baton to the next.",
            Rules: "FIVE BENDING POLES per team set 7–9 m apart at right angles to the Start/Finish Line, the first pole 9 m from the line. All riders start at the Start/Finish Line. On the signal, Number One rides down weaving through the poles, around the fifth pole, weaves back, and hands the baton to Number Two. Repeat for all four riders. Any pole knocked down must be replaced by the rider who knocked it, who resumes from where the fault occurred. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted and carrying the baton, with all five poles standing."),

        // ── Mug family ────────────────────────────────────────────────────
        ["Mug Changes"] = new Entry(
            Summary: "Four bending poles, two mugs — shuffle the mugs between poles in a set order using all four riders.",
            Rules: "FOUR BENDING POLES set 7–9 m apart at right angles to the Start/Finish Line, the first 9 m from the line; one MUG (upright) on Pole 2 and another on Pole 4. Numbers 1 and 3 at the Start/Finish; Numbers 2 and 4 at the Changeover Line. Number One (carrying a mug) places it on Pole 1, picks the mug off Pole 2 and places it on Pole 3, picks the mug off Pole 4 and hands it to Number Two over the Changeover Line. Number Two reverses the pattern: places the mug on Pole 4, picks Pole 3's mug to Pole 2, picks Pole 1's mug and hands to Number Three over the Start/Finish Line. Numbers 3 and 4 repeat. Mugs must be placed mouth-up; any error must be corrected from the point at which it occurred. THE WINNING TEAM is the one whose Number Four crosses the Start/Finish Line first, mounted, with mugs on Poles 2 and 4."),

        ["Two Mug"] = new Entry(
            Summary: "Four poles, two mugs starting on Poles 1 and 3 — shuffle them between poles using all four riders.",
            Rules: "FOUR BENDING POLES 7–9 m apart, first pole 9 m from the Start/Finish Line; MUGS upright on Poles 1 and 3. Numbers 1 and 3 at Start/Finish; 2 and 4 at the Changeover Line. Number One moves the Pole-1 mug to Pole 2, then the Pole-3 mug to Pole 4 and crosses the Changeover. Number Two moves the Pole-4 mug to Pole 3, then the Pole-2 mug to Pole 1 and crosses the Start/Finish Line. Numbers 3 and 4 repeat exactly. Mugs upright at all times; faults must be corrected by the responsible rider. THE WINNING TEAM is the one whose Number Four crosses the Start/Finish Line first, mounted, with mugs on Poles 1 and 3."),

        ["One Mug Race (Junior)"] = new Entry(
            Summary: "Junior version — one mug shuffles between Pole 2 and Pole 3 across all four riders.",
            Rules: "JUNIOR VERSION. Four Bending Poles 7–9 m apart; MUG upright on Pole 2. Numbers 1 and 3 at Start/Finish; 2 and 4 at Changeover. Number One moves the mug from Pole 2 to Pole 3 and crosses Changeover. Number Two moves it from Pole 3 to Pole 2 and crosses Start/Finish. Numbers 3 and 4 repeat. Mug must stay upright; faults corrected from where they occurred. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with the mug on Pole 2."),

        // ── Flag family ───────────────────────────────────────────────────
        ["Two Flag"] = new Entry(
            Summary: "A single flag moves between two flag cones level with Poles 1 and 4 across all four riders.",
            Rules: "TWO FLAG CONES per team, level with Pole 1 and Pole 4; one FLAG starting in the Pole-4 cone, another carried by Number One at the Start/Finish. Numbers 1 and 3 at Start/Finish, 2 and 4 at Changeover. Each rider in turn carries a flag forward, places it in one cone and collects the flag from the other on the way back, handing over behind the appropriate line. Knocked cones must be reset by the rider concerned. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, carrying a flag and with a flag in the Pole-4 cone."),

        ["Five Flag"] = new Entry(
            Summary: "Five flags moved one by one into the Changeover-end cone by the four riders.",
            Rules: "ONE FLAG CONE level with Pole 5 and ANOTHER on the Centre Line. Four flags begin in the Centre-Line cone; Number One starts carrying the fifth. All riders at Start/Finish. Each rider in turn places the flag they are carrying in the Pole-5 cone and picks a flag from the Centre Line on the way back, handing on at the Start/Finish Line. Number Four places the final flag in the Pole-5 cone and returns carrying the flag they collected. Knocked cones reset by the rider concerned. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, carrying a flag, with four flags in the Pole-5 cone."),

        // ── Bottle ────────────────────────────────────────────────────────
        ["Bottle"] = new Entry(
            Summary: "Shuffle a senior bottle between a table on the Centre Line and another at the Changeover.",
            Rules: "TWO TABLES per team: one on the Centre Line and one 3 m beyond the Changeover Line. A 750-ml SENIOR BOTTLE (500 g) stands on the Changeover table; another is carried by Number One. Numbers 1 and 3 at Start/Finish, 2 and 4 at Changeover. Each rider in turn places the bottle they carry on the Centre table, picks the bottle off the Changeover table and hands it to the next rider over the appropriate line. Knocked bottles or tables must be replaced upright before the rider continues. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, carrying the bottle, with a bottle on the Changeover table."),

        // ── Stepping Stones ──────────────────────────────────────────────
        ["Stepping Stones"] = new Entry(
            Summary: "Six stones straddling the Centre Line — dismount, lead the pony across, remount, continue.",
            Rules: "SIX STEPPING STONES set 30 cm apart in a straight line up and down the arena, straddling the Centre Line. Numbers 1 and 3 at Start/Finish; 2 and 4 at Changeover. Each rider in turn rides to the stones, dismounts before the first stone, leads the pony and walks across the six stones touching each in turn (no jumping), remounts beyond the last stone and continues. The last rider's foot must land on the OPPOSITE side from the side they entered. Stepping off or knocking stones means the rider must return to the start of the line and re-cross from the same direction. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with all six stones standing."),

        // ── Litter ────────────────────────────────────────────────────────
        ["Litter"] = new Entry(
            Summary: "Spear four pieces of litter with a cane, drop each in the bin on the Centre Line.",
            Rules: "FOUR PIECES OF LITTER side-by-side in a circle 3 m beyond the Changeover Line, open ends towards Start/Finish; LITTER BIN on the Centre Line. Each rider in turn rides up carrying the litter CANE, spears one piece of litter at the Changeover end and drops it into the bin on the way back, then hands the cane on. Litter must not be touched by hand except to clear a jam from the cane. Number Four returns carrying the cane. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, carrying the cane, with all four pieces of litter in the bin."),

        // ── Equipment / Bowl family ──────────────────────────────────────
        ["Old Sock"] = new Entry(
            Summary: "Four socks in a circle behind the Changeover, dropped one-by-one into the bin on the Centre Line.",
            Rules: "FOUR SOCK-BALLS in a circle 3 m beyond the Changeover Line; LITTER BIN on the Centre Line. Number One starts carrying a sock; all other riders empty-handed. Each rider in turn drops the sock they carry into the bin on the way up, rides on, dismounts beyond the Changeover, picks one sock from the circle and remounts before re-crossing the Changeover. Hands the sock to the next rider behind the appropriate line. Number Four drops the last sock in the bin on the way back. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with FIVE socks in the bin."),

        // ── Big Sack ──────────────────────────────────────────────────────
        ["Big Sack"] = new Entry(
            Summary: "All four riders cross the line together in one big sack down the arena.",
            Rules: "BIG SACK placed 1 m beyond the Centre Line. NUMBER FIVE waits dismounted at the Changeover to hold the ponies. Numbers 1 and 3 ride leading 2 and 4 mounted to the Changeover. 2 and 4 dismount, hand ponies to Number Five and run back to the Big Sack. All four riders step into the sack and travel down the arena to the Start/Finish Line. The sack must be held above the riders' knees while they travel. THE WINNING TEAM is the first whose four mounted/dismounted members and the sack cross the Start/Finish Line together."),

        // ── PGUK pyramid + sponsor-branded variants ──────────────────────
        ["Pyramid – PGUK Version"] = new Entry(
            Summary: "Stack four lettered boxes on a table to spell P G U K, top to bottom.",
            Rules: "TWO TABLES — one on the Centre Line and one 3 m beyond the Changeover. The Changeover table holds four 500-g plastic boxes lettered K, U, G, P placed front-right, back-right, back-left and front-left as viewed from Start/Finish. Numbers 1 and 3 at Start/Finish, 2 and 4 at Changeover. Number One rides up, collects box K (front-right), returns and stands it upright on the Centre table. Number Two adds U on top, Number Three adds G, Number Four adds P. The final stack must read P–G–U–K top-to-bottom. Boxes may be adjusted upright at any time. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with the stack correct."),

        // ── Spell EGUK + JV ──────────────────────────────────────────────
        ["Spell E G U K"] = new Entry(
            Summary: "Eight cards from a centre-line table hung on the gibbet to spell EGUK across the top, logos across the bottom.",
            Rules: "ONE TABLE on the Centre Line holding eight cards face-down: four lettered E, G, U, K and four EGUK-logo cards. ONE GIBBET (with two horizontal crossbars of four hooks each) 3 m beyond the Changeover. All riders at Start/Finish. Each rider in turn collects TWO CARDS from the table — they may be picked one at a time — and rides on to hang both on the gibbet so the TOP ROW reads E–G–U–K (left to right as viewed from Start/Finish) and the BOTTOM ROW shows four EGUK logos. Dropped cards may be retrieved dismounted but MUST be hung mounted. Mis-placed cards must be corrected by the responsible rider before continuing. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with all eight cards correctly hung."),

        ["Spell EGUK (JV)"] = new Entry(
            Summary: "Junior version of Spell EGUK — same rules with the JV card set and adjusted gibbet height.",
            Rules: "JUNIOR VERSION. Set up and procedure identical to Spell E G U K but using the JV card set and the gibbet set to junior height. The top row must spell E–G–U–K and the bottom row must show four EGUK logos. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with all eight cards correctly hung."),

        // ── STRUK Pole + JV ──────────────────────────────────────────────
        ["STRUK Pole"] = new Entry(
            Summary: "Slot lettered cartons on a pole to spell S–T–R–U–K with three blanks beneath.",
            Rules: "ONE BENDING POLE on the centre line of the lane level with Pole 1. SEVEN CARTONS in a circle 3 m beyond the Changeover lettered S, T, R, U, K and two blanks; Number One starts carrying the eighth carton (a blank). Numbers 1 and 3 at Start/Finish; 2 and 4 at Changeover. Each rider in turn rides up, slots the carton they're carrying over the pole and picks the next carton from the circle on the way back. The final stack top-to-bottom must read S, T, R, U, K, blank, blank, blank. Cartons must be slotted right-side up. Number One starts with a blank so the K rider has S–T–R–U on the pole. Mis-orders or upside-down cartons must be corrected by the responsible rider. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with the pole correctly stacked."),

        ["STRUK Pole (JV)"] = new Entry(
            Summary: "Junior version of STRUK Pole — same stacking pattern with the JV carton set.",
            Rules: "JUNIOR VERSION. Set up and procedure identical to STRUK Pole but using the JV carton set. The final stack top-to-bottom must read S, T, R, U, K, blank, blank, blank. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with the pole correctly stacked."),

        // ── PGSports / Sponsored renames ─────────────────────────────────
        ["PG Sports Shopping Spree Race"] = new Entry(
            Summary: "Four riders trade pennies for branded shopping bags and hang them on hooks under the Penny Dish.",
            Rules: "ONE BENDING POLE on the Centre Line topped with a PENNY DISH that has FOUR HOOKS underneath; four pennies stacked in the dish. ONE TABLE 3 m beyond the Changeover holding a bucket containing four BRANDED SHOPPING BAGS (each containing a Junior bottle). NUMBER FIVE stands at the Changeover. All four riders at Start/Finish. Each rider in turn rides up, picks a penny from the dish, rides to the Changeover, drops the penny in the bucket, takes a shopping bag from Number Five and hangs both handles on a free hook beneath the dish on the way back. The bag must be hung mounted; dropped bags retrieved dismounted but hung mounted. THE WINNING TEAM is the team whose Number Four crosses the Start/Finish Line first, mounted, with four pennies in the bucket and four bags correctly hung."),
    };
}
