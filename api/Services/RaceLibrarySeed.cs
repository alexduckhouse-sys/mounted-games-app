namespace MountedGames.Api.Services;

/// <summary>
/// Canonical Pony Club Mounted Games race library — Team (4-rider) versions.
/// Pairs and Junior Versions can be added by admins via the Race Rules page.
///
/// Diagram positions are percentages 0–100 along the lane (start → finish).
/// Element types: pole, cone, item, table, midline.
/// </summary>
internal static class RaceLibrarySeed
{
    public record Entry(string Name, string Category, string Summary, string Rules, string DiagramJson);

    // -- Diagram templates ---------------------------------------------------
    // Reused across many races; gives admins something visually useful per race type.

    private const string FivePoles =
        """[{"t":"pole","x":17,"label":"1"},{"t":"pole","x":33,"label":"2"},{"t":"pole","x":50,"label":"3"},{"t":"pole","x":67,"label":"4"},{"t":"pole","x":83,"label":"5"}]""";
    private const string FourPoles =
        """[{"t":"pole","x":17,"label":"1"},{"t":"pole","x":39,"label":"2"},{"t":"pole","x":61,"label":"3"},{"t":"pole","x":83,"label":"4"}]""";
    private const string MidlineOnly =
        """[{"t":"midline"}]""";
    private const string ChangeoverItem =
        """[{"t":"item","x":90,"label":""}]""";
    private const string TableMidlineAndChangeover =
        """[{"t":"table","x":50,"label":""},{"t":"table","x":90,"label":""},{"t":"midline"}]""";
    private const string TableAtPole1AndChangeover =
        """[{"t":"table","x":17,"label":""},{"t":"table","x":90,"label":""}]""";
    private const string ConeMidAndChangeover =
        """[{"t":"cone","x":50,"label":""},{"t":"cone","x":90,"label":""},{"t":"midline"}]""";
    private const string FourConesAtPoles =
        """[{"t":"cone","x":17,"label":"1"},{"t":"cone","x":39,"label":"2"},{"t":"cone","x":61,"label":"3"},{"t":"cone","x":83,"label":"4"}]""";
    private const string TwoFlagCones =
        """[{"t":"cone","x":17,"label":"Flags"},{"t":"cone","x":83,"label":"Flags"}]""";
    private const string ThreeFlagCones =
        """[{"t":"cone","x":17,"label":"Flags"},{"t":"cone","x":50,"label":"Flags"},{"t":"cone","x":83,"label":"Flags"},{"t":"midline"}]""";
    private const string LetterPole =
        """[{"t":"pole","x":17,"label":"Pole"},{"t":"item","x":88,"label":"Cartons"},{"t":"midline"}]""";
    private const string SpellTableAndGibbet =
        """[{"t":"table","x":50,"label":"Cards"},{"t":"item","x":90,"label":"Gibbet"},{"t":"midline"}]""";
    private const string CircleAtChangeover =
        """[{"t":"item","x":90,"label":"Circle"},{"t":"midline"}]""";
    private const string FishingSetup =
        """[{"t":"item","x":50,"label":"Bin"},{"t":"item","x":90,"label":"Gibbet"},{"t":"midline"}]""";
    private const string BowlingSetup =
        """[{"t":"item","x":85,"label":"Bottles"},{"t":"item","x":75,"label":"Bucket"},{"t":"midline"}]""";
    private const string HiLoSetup =
        """[{"t":"cone","x":17,"label":"1"},{"t":"cone","x":39,"label":"2"},{"t":"cone","x":61,"label":"3"},{"t":"cone","x":83,"label":"4"},{"t":"item","x":92,"label":"Net"}]""";
    private const string PostBoxSetup =
        """[{"t":"pole","x":17,"label":"Coin"},{"t":"item","x":50,"label":"Post Box"},{"t":"item","x":90,"label":"Papers"}]""";

    public static readonly Entry[] All = new[]
    {
        // ── Bending family ─────────────────────────────────────────────────
        new Entry("Bending", "Bending",
            "Weave down and back through five bending poles, pass the baton, all four riders complete.",
            "Five Bending Poles 7–9 m apart. On the signal each rider in turn rides down and back through the line, then hands the baton to the next rider behind the Start/Finish Line. Any pole knocked down must be replaced by the rider concerned, who resumes from where it fell. The winning team is the one whose Number Four crosses the Start/Finish Line first, mounted and carrying the baton.",
            FivePoles),

        new Entry("Mug Changes", "Mug",
            "Four poles, two mugs — move mugs back and forth between poles in sequence.",
            "Four Bending Poles 7–9 m apart, mugs on Poles 2 and 4. Riders 1 & 3 start at Start/Finish; 2 & 4 at Changeover. Number One (carrying a mug) places on Pole 1, picks from Pole 2 and places on Pole 3, picks from Pole 4 and hands to Number Two. Pattern reverses going back. Mugs must be placed in correct order — any error must be corrected before continuing. Winner: Number Four first over the line, mounted, with mugs on Poles 2 and 4.",
            FourPoles),

        new Entry("Two Mug", "Mug",
            "Move two mugs along a row of poles, working as a team of four.",
            "Four Bending Poles 7–9 m apart; mugs on Poles 1 and 3. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves Mug from 1→2 then 3→4, then crosses Changeover. Number Two moves Mug from 4→3 then 2→1, then crosses Start/Finish. Numbers 3 & 4 repeat. Mugs must move in the correct sequence — any error must be corrected. Winner: Number Four first over the line with mugs on Poles 1 and 3.",
            FourPoles),

        new Entry("Three Mug", "Mug",
            "Shuffle three mugs along a row of four poles.",
            "Four Bending Poles 7–9 m apart, mugs on Poles 2, 3 and 4, all riders at Start/Finish. Number One: Mug 2→1, 3→2, 4→3. Number Two: Mug 3→4, 2→3, 1→2. Numbers 3 and 4 repeat. Mugs must be moved in order; missed mugs must be replaced before continuing. Winner: Number Four first over the line with mugs on Poles 2, 3 and 4.",
            FourPoles),

        new Entry("Five Mug – Pole Specific", "Mug",
            "Place mugs on bending poles in a specific order, including an EGUK logo mug on Pole 1.",
            "Five Bending Poles 7–9 m apart; table 3 m behind Changeover with four inverted mugs (one with EGUK logo at front-left). Each rider places a mug on the designated pole (2, 3, 4 in turn) and brings back another mug. Number Four places on Pole 5, collects the EGUK mug, and places it on Pole 1 on the way back. Mugs must be replaced inverted. Winner: Number Four first over the line with a mug on every pole and the EGUK mug on Pole 1.",
            FivePoles),

        new Entry("One Mug Race (Junior)", "Mug",
            "Junior version — one mug moves between Pole 2 and Pole 3.",
            "Four Bending Poles 7–9 m apart; mug on Pole 2. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves the mug from Pole 2 to Pole 3 then crosses Changeover. Number Two moves it back from Pole 3 to Pole 2 then crosses Start/Finish. Numbers 3 & 4 repeat. Winner: Number Four first over the line with the mug on Pole 2.",
            FourPoles),

        // ── Ball / Cone family ────────────────────────────────────────────
        new Entry("Ball and Cone", "Ball",
            "Move a tennis ball back and forth between two cones level with Poles 1 and 4.",
            "Two Ball Cones per team level with Poles 1 and 4; tennis ball starts on the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One (carrying a ball) places on Pole 1 cone, collects from Pole 4 cone, hands to Number Two. Number Two places on Pole 4, collects from Pole 1, hands to Number Three. Numbers 3 & 4 repeat. Winner: Number Four first over the line carrying the ball with another ball on the Pole 4 cone.",
            FourConesAtPoles),

        new Entry("Ball and Flag", "Ball",
            "Combine ball-on-cone with flag-in-cone across two stations.",
            "Ball Cone level with Pole 1 and Flag Cone (with flag) level with Pole 4. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One places the ball on Pole 1 cone, collects the flag from Pole 4 cone and hands to Number Two. Number Two replaces the flag in the cone, collects the ball and hands to Number Three. Numbers 3 & 4 repeat. Winner: Number Four first over the line carrying the ball with the flag in the Flag Cone.",
            """[{"t":"cone","x":17,"label":"Ball"},{"t":"cone","x":83,"label":"Flag"}]"""),

        new Entry("Ball and Racquet", "Ball",
            "Balance a tennis ball on a racquet through four bending poles.",
            "Four Bending Poles 7–9 m apart; tennis racquet and ball per team. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries the ball on the racquet head, weaving through the poles, and hands over behind the line. Hand must always be behind the racquet's crosspiece. If the ball drops, the rider must retrieve and continue from where it fell.",
            FourPoles),

        new Entry("Ball and Socket", "Ball",
            "Place a ball into a high socket board at the changeover, then return collecting from a cone.",
            "Four Ball Cones level with Poles 1–4, each holding a tennis ball; a Bending Pole topped with a 4-socket Socket Board 3 m beyond the Changeover. Each rider in turn carries a ball, places it into a socket, then collects a ball from any cone on the way back. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball.",
            FourConesAtPoles),

        new Entry("Ball and Socket – Cone Specific", "Ball",
            "As Ball and Socket but each rider must collect from a specific cone (4, 3, 2, then 1).",
            "Same setup as Ball and Socket. Each rider in turn places their ball into a socket and on the return must collect from the cone level with Pole 4, then 3, 2 and 1 in rider order. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball, with a ball in every socket.",
            FourConesAtPoles),

        new Entry("Ball and Bucket", "Ball",
            "Pick up tennis balls from the changeover end and drop them in a bucket on the midline.",
            "Four tennis balls per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a ball) drops it into the bucket, rides on to the Changeover, dismounts, picks up a ball, remounts and returns. Numbers 2, 3, 4 repeat. Number Four drops the last ball into the bucket on the way back. Winner: first Number Four over the line with 5 balls in the bucket.",
            ConeMidAndChangeover),

        new Entry("Boule and Bucket", "Ball",
            "Same as Ball and Bucket but with plastic boules instead of tennis balls.",
            "Four plastic boules per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Each rider in turn drops a boule in the bucket on the way up, dismounts at the Changeover to collect another and brings it back. Number Four drops the last on the way back. Winner: first Number Four over the line with 5 boules in the bucket.",
            ConeMidAndChangeover),

        new Entry("Tennis Ball Shuffle", "Ball",
            "Move a tennis ball between a socket on the centre line and two cones level with Poles 1 and 4.",
            "Pole on the Centre Line topped with a socket (ball starts at the 9 o'clock position); cones level with Poles 1 and 4. Number One: ball→Cone 1, then socket→Cone 4. Number Two: Cone 4→socket, then Cone 1→hands to Number Three. Numbers 3 & 4 repeat. Number Four carries the final ball over the line.",
            FourConesAtPoles),

        new Entry("Four Ball Cone (Tennis Ball Shuffle)", "Ball",
            "Collect a tennis ball from a penny dish at the Changeover and place on cones one by one.",
            "Four Ball Cones level with Poles 1–4; a pole topped with a Penny Dish containing four tennis balls 3 m beyond the Changeover. Each rider in turn collects a ball from the Penny Dish and places it on any cone on the way back. Winner: Number Four first over the line with a ball on every cone.",
            FourConesAtPoles),

        // ── Flag family ───────────────────────────────────────────────────
        new Entry("Two Flag", "Flag",
            "Move a single flag between two flag cones level with Poles 1 and 4.",
            "Two Flag Cones per team level with Poles 1 and 4; flag starts in the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries a flag, places it in one cone and collects from the other. Knocked cones must be reset immediately by the rider. Winner: Number Four first over the line carrying a flag.",
            """[{"t":"cone","x":17,"label":"Flag"},{"t":"cone","x":83,"label":"Flag"}]"""),

        new Entry("Four Flag", "Flag",
            "Distribute four flags from a centre cone into two outer cones.",
            "Three Flag Cones per team — level with Poles 1, on the Centre Line and level with Pole 5. Four flags start in the centre cone. Each rider in turn collects a flag from the centre cone and places it into one of the other cones, then crosses the Start/Finish Line. Winner: Number Four first over the line with two flags in each outer cone and the centre cone empty.",
            ThreeFlagCones),

        new Entry("Five Flag", "Flag",
            "Place flags one by one into the Changeover-end cone.",
            "Flag Cone 3 m behind the Changeover and another on the Centre Line; five flags — four start in the centre cone, one carried by Number One. Each rider in turn places their flag in the Changeover cone and brings one back from the centre cone. Winner: Number Four first over the line carrying a flag, with four flags in the Changeover cone.",
            ThreeFlagCones),

        new Entry("Tubular Flag Race", "Flag",
            "Place flags into matching tubes on a 4-Flag Holder behind the Changeover.",
            "4-Flag Holder (central blue tube, three white tubes around it) 3 m behind the Changeover; four white flags in a Flag Cone on the Centre Line. Number One places the BLUE PG LOGO flag into the centre blue tube (mounted); each subsequent rider matches a white flag to any white tube. Number Four collects the final flag from the centre cone on the way back. Winner: Number Four first over the line carrying the flag.",
            """[{"t":"cone","x":50,"label":"Flags"},{"t":"item","x":90,"label":"4-Tube"},{"t":"midline"}]"""),

        // ── Bottle family ─────────────────────────────────────────────────
        new Entry("Bottle", "Bottle",
            "Shuffle a 500 g bottle between a table on the centre line and another at the Changeover.",
            "Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. A 750 ml bottle weighing 500 g sits on the Changeover table; another similar bottle is carried by Number One. Each rider in turn places one bottle on the centre table, collects the other from the Changeover table and hands it on. Knocked bottles/tables must be replaced upright. Winner: Number Four first over the line, mounted, carrying the bottle.",
            TableMidlineAndChangeover),

        new Entry("Bottle Collection", "Bottle",
            "Build up a 4-bottle carrier from bottles at the Changeover end.",
            "Table level with Pole 1 and another 3 m beyond the Changeover; four weighted plastic bottles on the Changeover table. Number One (carrying a plastic Bottle Carrier) places it on the Pole 1 table, rides on to collect a bottle and places it in the Carrier. Numbers 2, 3 and 4 each add a bottle. Number Four picks up the full Carrier and carries it across the line. Knocked bottles must be replaced upright.",
            TableAtPole1AndChangeover),

        new Entry("Quoit and Bottle", "Bottle",
            "Place a bottle on a table and ring it with four quoits.",
            "Table level with Pole 1; four rubber quoits in a circle 3 m beyond the Changeover. Number One (carrying a bottle, senior 500 g) places it upright on the table, rides on to collect a quoit dismounted and rings the bottle on the way back. Numbers 2, 3 and 4 each add a quoit. Bottle must remain upright; quoits must be fully over the bottle. Winner: Number Four first over the line with the bottle ringed by four quoits.",
            TableAtPole1AndChangeover),

        // ── Sack family ───────────────────────────────────────────────────
        new Entry("Big Sack", "Sack",
            "All four riders run together in one big sack down the arena.",
            "Big Sack 1 m beyond the Centre Line; Number Five at the Changeover holding the ponies. Numbers 1 & 3 lead Numbers 2 & 4 mounted to the Changeover where 2 & 4 dismount and hand ponies to Number Five. All four then run back, step into the Big Sack and travel in it across the Start/Finish Line. Winner: first team whose sack with all four members crosses the line.",
            MidlineOnly),

        new Entry("Small Sack", "Sack",
            "Each rider in turn dismounts and jumps in a sack down the arena.",
            "Numbers 1 (carrying a sack) & 3 mounted at Start/Finish; 2 & 4 at Changeover. Each rider rides forward, dismounts before the Centre Line, gets into the sack and runs/jumps leading their pony to the next changeover line, where they hand the sack over. Sack must be held above knee level; ponies led by the near rein. Winner: Number Four first over the line on their feet in the sack.",
            MidlineOnly),

        new Entry("Three-Legged Sack", "Sack",
            "Pairs of riders run together in one sack — one leg each.",
            "Numbers 1 & 3 mounted at Start/Finish; 2 & 4 at Changeover. Number One rides up carrying a sack, dismounts beyond the Changeover; Number Two dismounts too. Each puts one leg into the sack, holds it in one hand and their pony in the other, and they run back together across the Start/Finish Line. Number Three then carries the sack up to Number Four to repeat. Winner: Numbers 3 & 4 first over the line.",
            MidlineOnly),

        // ── Dismount family ───────────────────────────────────────────────
        new Entry("Stepping Stones", "Dismount",
            "Dismount, lead pony and walk across six stones straddling the centre line, then remount.",
            "Six Stepping Stones 30 cm apart in a line up and down the arena across the Centre Line. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider rides to the stones, dismounts and leads their pony, stepping on each stone and the ground with the opposite foot from the final stone, then remounts and continues. Knocked stones / stepping off must be corrected from the original direction. Winner: Number Four first over the line.",
            MidlineOnly),

        new Entry("Hurdles", "Dismount",
            "Negotiate four alternating-height hurdles by stepping over and crawling under.",
            "Four hurdles 1.85 m apart straddling the Centre Line, alternately low and high; mug on each of the higher hurdles. Pairs of riders ride up together: one dismounts and hands their pony to the other, then steps over/crawls under in the pattern, remounts and both ride on. Each pair takes a turn. Knocked hurdles or fallen mugs must be replaced and the rider re-negotiates all hurdles. Winner: final pair first across the Start/Finish Line, mounted.",
            MidlineOnly),

        new Entry("Tyre", "Dismount",
            "Pass a motorcycle tyre over a rider standing on the centre line, in pairs.",
            "Motorcycle tyre on the Centre Line. Numbers 1 & 2 at Start/Finish, 3 at Changeover, 4 behind the 6-m line. Pairs ride up; one dismounts, hands pony to the other, steps through the tyre, remounts and the pair continues. Each pair takes a turn. Tyre must stay between Poles 2 and 3 in the lane; ponies led by the near rein. Winner: the final pair (1 & 4) first across the line mounted.",
            MidlineOnly),

        new Entry("Grooms", "Dismount",
            "Lead a riderless pony through four bending poles, handing it on at each changeover.",
            "Four Bending Poles 7–9 m apart. Number One holds Number Two's pony at Start/Finish; 3 holds 4's behind the 6-m line; 2 holds 3's at Changeover; 4 stands behind 2 at Changeover. Riders take turns weaving through the poles leading the next rider's pony, handing off at the changeover so the next rider mounts and continues. Ponies led by the rein nearer the ridden pony. Letting go means returning to the fault point.",
            FourPoles),

        // ── Equipment / Trays ─────────────────────────────────────────────
        new Entry("Equipment Jumble", "Equipment",
            "Build a stack of pyramid box, quoit, mug and tennis ball on a table at Pole 1.",
            "Four items in a circle 3 m behind the Changeover — Pyramid Box, Quoit, Mug and Tennis Ball. Table level with Pole 1. Number One collects the Pyramid Box and places it on the table. Number Two adds the Quoit on top. Number Three adds the Mug (open end up, inside the Quoit). Number Four adds the Tennis Ball inside the Mug. All four items must remain stacked. Winner: Number Four first over the line with the stack intact.",
            TableAtPole1AndChangeover),

        new Entry("Farmers' Market", "Equipment",
            "Fill a tack-box tray with sausages, potato, egg box and milk from the changeover.",
            "Table level with Pole 1; four items (sausages, potato, egg box, milk bottle — upright) in a circle 3 m behind the Changeover. Number One places a Tack Box Tray on the table then collects the bottle and adds it. Number Two adds the potato, Number Three the sausages, Number Four the egg box and then picks up the full tray to carry across the line. Bottle must be upright while in the circle and in the tray until Number Four collects it.",
            TableAtPole1AndChangeover),

        new Entry("Tack Shop", "Equipment",
            "Five-rider race — Number Five hands tack items into a grooming tray on a table.",
            "Bending Pole topped with Penny Dish level with Pole 1; Grooming Tray on a table level with Pole 4; Number Five at the Changeover with a table holding dandy brush, saddle soap, tail bandage and curry comb. Each of riders 1–4 carries a coin to the Penny Dish, collects the Grooming Tray, rides to Number Five who places an item in it, then returns the tray to the Pole 4 table, retrieves the coin and hands to the next rider. Winner: Number Four first over the line carrying the coin with all four items in the tray.",
            TableAtPole1AndChangeover),

        new Entry("Bean Bag and Table", "Equipment",
            "Stack three bean bags and a tennis ball on a table level with Pole 1.",
            "Table level with Pole 1; three bean bags and a tennis ball placed randomly in a circle 3 m behind the Changeover. All four riders at Start/Finish. Numbers 1, 2 and 3 each ride up, dismount, collect a bean bag and place it on the table. Number Four collects the tennis ball and places it on the table. Bean bags and ball may touch. Winner: Number Four first over the line with all items on the table.",
            TableAtPole1AndChangeover),

        new Entry("Litter", "Equipment",
            "Spear pieces of litter with a cane and drop them in a bin on the centre line.",
            "Four pieces of litter side-by-side in a circle 3 m beyond the Changeover (open ends towards the Start/Finish); litter bin on the Centre Line. Each rider in turn rides up with a cane, spears a piece of litter at the Changeover and drops it into the bin on the way back. Litter must not be touched by hand except to clear jams. Winner: Number Four first over the line carrying the cane with all four pieces in the bin.",
            ConeMidAndChangeover),

        new Entry("Old Sock", "Equipment",
            "Drop four socks-as-balls into a bucket on the centre line.",
            "Four sock-balls in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a sock) drops it in the bucket, rides on, dismounts, picks up another sock and brings it back. Numbers 2, 3 and 4 repeat. Number Four drops the last sock on the way back. Winner: first Number Four over the line with 5 socks in the bucket.",
            ConeMidAndChangeover),

        new Entry("Balloon and Cone", "Equipment",
            "Burst six balloons on a board along the centre line using a pin-tipped cane.",
            "Six balloons attached 46 cm apart to a board straddling the Centre Line; pin-tipped 1.22 m cane. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn rides through bursting at least one balloon and hands the cane on. Each rider must burst at least one balloon or the team is eliminated. Winner: Number Four first over the line carrying the cane with at least four balloons burst.",
            MidlineOnly),

        new Entry("Knickerbocker Glory Race", "Equipment",
            "Carry a plastic ball in an ice-cream cone weaving through five bending poles.",
            "Five Bending Poles 7–9 m apart per team; an Ice Cream Cone and a ~15 cm ball per team. Each rider in turn rides down and back bending through the poles holding the cone, ball balanced in it. Ball not to be touched by hand except when remounting. Drops must be retrieved and replaced before continuing. Winner: Number Four first over the line carrying the cone with the ball on it.",
            FivePoles),

        new Entry("Recycling Race", "Equipment",
            "Sort four recycling items into the correct slot of a wheelie bin level with Pole 1.",
            "120-litre wheelie bin with a 2-slot insert (circular, rectangular) level with Pole 1; bottle, tin can, newspaper and letter in a circle 3 m behind the Changeover. Number One opens the bin's lid then completes a rider's leg; Numbers 2 and 3 each complete one. Number Four completes the last leg and closes the lid before crossing the line. Bottles/cans through the circle, newspapers/letters through the slot. Insert in correct position throughout or the team is eliminated.",
            ChangeoverItem),

        // ── Letter-pole family ────────────────────────────────────────────
        new Entry("PGSPORTS Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole in the correct order to spell PGSPORTS.",
            "Bending pole level with Pole 1; seven lettered cartons (P G S P O R T) in a circle 3 m beyond the Changeover; the 8th carton (S) carried by Number One. Riders take turns slotting their carton over the pole and collecting the next one dismounted. Final order top to bottom: PGSPORTS. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole),

        new Entry("Pony Club Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole to spell PONY CLUB top-to-bottom.",
            "As PGSPORTS Pole but cartons spell PONY CLUB (P, O, N, Y, C, L, U, B). Bending pole level with Pole 1; cartons placed randomly in a circle 3 m beyond the Changeover. Wrong order or upside-down must be corrected.",
            LetterPole),

        new Entry("Spillers Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole to spell SPILLERS.",
            "As PGSPORTS Pole but the cartons spell SPILLERS (S, P, I, L, L, E, R, S). Bending pole level with Pole 1; cartons placed randomly in the Changeover circle. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole),

        new Entry("Robinsons Pole", "Letter Pole",
            "Slot nine lettered cartons onto a pole to spell ROBINSONS.",
            "As PGSPORTS Pole but the cartons spell ROBINSONS (R, O, B, I, N, S, O, N, S). Eight cartons in the Changeover circle and one carried by Number One. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole),

        new Entry("STRUK Pole", "Letter Pole",
            "Slot lettered and blank cartons to spell STRUK with three blanks beneath.",
            "Bending pole level with Pole 1; seven cartons in a circle 3 m beyond the Changeover with letters S, T, R, U, K and two blanks. Riders take turns slotting their carton (and bringing back the next). Final order top-to-bottom: S, T, R, U, K, blank, blank, blank (Number One starts with a blank).",
            LetterPole),

        // ── Spelling family ───────────────────────────────────────────────
        new Entry("Spell E G U K", "Spelling",
            "Pick up letter cards from the centre line and hang them in spelling order on a gibbet.",
            "Table on the Centre Line with eight cards (four letters E, G, U, K and four with the EGUK logo). Gibbet 3 m beyond the Changeover with two crossbars of four hooks each. Each of the four riders collects two cards in turn and hangs them on the correct hooks so the top row spells EGUK and the bottom row shows logos. Dropped cards may be retrieved dismounted but must be hung mounted.",
            SpellTableAndGibbet),

        new Entry("Spell EQUI TREK", "Spelling",
            "As Spell EGUK but the cards spell EQUI on top and TREK on the bottom.",
            "Table on the Centre Line with eight cards spelling EQUI TREK; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so EQUI sits across the top row and TREK across the bottom row. Dropped cards may be retrieved dismounted but must be hung from the mounted position.",
            SpellTableAndGibbet),

        new Entry("Spell PONY CLUB", "Spelling",
            "As Spell EGUK but the cards spell PONY on top and CLUB on the bottom.",
            "Table on the Centre Line with eight cards spelling PONY CLUB; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so PONY sits across the top row and CLUB across the bottom row.",
            SpellTableAndGibbet),

        new Entry("Spell PONY PREP", "Spelling",
            "As Spell EGUK but the cards spell PONY on top and PREP on the bottom.",
            "Table on the Centre Line with eight cards spelling PONY PREP; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so PONY sits across the top row and PREP across the bottom row.",
            SpellTableAndGibbet),

        // ── Sharpshooters / Bowling ───────────────────────────────────────
        new Entry("Sharpshooters (Version 1, with Target)", "Other",
            "Knock down two targets behind the Changeover by throwing tennis balls.",
            "Two Bending Poles 1 m apart, 3 m beyond the Changeover, each with a sleeved circular target on top. Bucket of 12 tennis balls in front of the Changeover. Two ponies for four riders. Pairs lead/ride to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover throws balls to knock down one target each. Foot on the line = 'fault, throw again'. Winner: Numbers 3 & 4 first over the line (Number 4 mounted) with both targets down.",
            CircleAtChangeover),

        new Entry("Sharp Shooters (Version 2, with Net)", "Other",
            "Throw tennis balls into a vertically-fixed net behind the Changeover.",
            "Bending pole 3 m beyond the Changeover topped with a vertical net (~30 cm wide). Bucket of 12 tennis balls in front of the Changeover. Two ponies for four riders. Pair rides to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover throws balls until one lands in and stays in the net. Foot on the line = throw again. Winner: Numbers 3 & 4 first over the line with two balls in the net.",
            CircleAtChangeover),

        new Entry("Bowling", "Other",
            "Knock down four bottles behind the Changeover using thrown boules.",
            "Four 500 g bottles 30 cm apart 3 m beyond the Changeover; bucket of 12 boules in front of the Changeover. Two ponies for four riders. Pairs lead/ride to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover bowls one boule to knock a single bottle (extras must be reset). Pair returns, swaps and the next pair repeats. Winner: Numbers 3 & 4 first over the line (Number 4 mounted) with all four bottles down.",
            BowlingSetup),

        // ── Hi Lo / Rope ──────────────────────────────────────────────────
        new Entry("HI LO – Cone Specific", "Ball",
            "Place balls into a high net behind the Changeover, collecting from cones in reverse order.",
            "Four Ball Cones level with Poles 1–4 with a tennis ball on each; 2.13 m pole topped with a net 3 m beyond the Changeover. Number One (carrying a ball) places it in the net, collects from Cone 4 on the way back. Number Two collects from Cone 3, Number Three from Cone 2, Number Four from Cone 1. Missed balls may be retrieved dismounted but must be put in the net mounted.",
            HiLoSetup),

        new Entry("Rope", "Other",
            "Pairs of riders carry a rope between them through four bending poles.",
            "Four Bending Poles 7–9 m apart per team; ~90 cm rope (no loops or knots). Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One weaves up carrying the rope; at the Changeover, Number Two grasps the rope and they weave back together. After crossing Start/Finish, Number Three takes the rope; Numbers 2 & 3 weave up together; Number Four joins for the final leg back. Holding of hands is not permitted. Winner: Numbers 3 & 4 first over the line, mounted, carrying the rope.",
            FourPoles),

        // ── Specialty ─────────────────────────────────────────────────────
        new Entry("Sword", "Other",
            "Lance sword rings off the tops of bending poles.",
            "Four Bending Poles 7–9 m apart per team; plastic sword ring (100 mm hole) on each pole, secured with an elastic band. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries the sword down the arena, collecting one ring off the top of any pole, and hands the sword on at the next changeover line. Hand must be behind the sword's crosspiece throughout. Knocked rings may be picked up dismounted; place against a pole to remount if needed. Winner: Number Four first over the line carrying the sword with all four rings on it.",
            FourPoles),

        new Entry("Postman's", "Other",
            "Deliver a letter into a post bag through four bending poles.",
            "Four Bending Poles 7–9 m apart per team; Number Five dismounted 3 m beyond the Changeover holding four letters. Each rider in turn carries the Post Bag through the poles to Number Five who hands them a letter; rider puts it in the bag and rides back through the poles to hand the bag on. Letter must be in the bag and hand out of the bag before re-crossing the Changeover. Winner: Number Four first over the line carrying the bag with four letters.",
            FourPoles),

        new Entry("Post Box", "Other",
            "Five-rider race — post newspapers through a post box on the centre line.",
            "Bending Pole topped with a Penny Dish level with Pole 1; post box (122 cm tall, 25 cm slot) on the Centre Line; Number Five with four A4 newspapers in a circle 3 m behind the Changeover. Each of riders 1–4 carries a coin to the Penny Dish, collects a newspaper from Number Five, rides back and posts it through the post box (pushing from the changeover side), then collects the coin and hands it on. Newspaper must not be folded. Winner: Number Four first over the line carrying the coin.",
            PostBoxSetup),

        new Entry("Pyramid – PGUK Version", "Equipment",
            "Stack four lettered boxes on the centre table to spell P G U K top-to-bottom.",
            "Table on the Centre Line and another 3 m beyond the Changeover. The Changeover table holds four unstacked 500 g plastic boxes lettered K, U, G, P (front-right, back-right, back-left, front-left as viewed from Start/Finish). Number One collects K and places it on the centre table; Number Two adds U; Number Three adds G; Number Four adds P. Stack must spell P G U K top-to-bottom. Boxes can be adjusted before/after placing.",
            TableMidlineAndChangeover),

        new Entry("PG Sports Shopping Spree Race", "Other",
            "Trade pennies for shopping bags and hang them on hooks under the Penny Dish.",
            "Bending pole on the Centre Line topped with a Penny Dish that has four hooks underneath; four pennies stacked in the dish. Table 3 m beyond the Changeover holding a bucket with four branded shopping bags (each containing a Junior bottle). Each rider in turn carries a penny to Number Five at the Changeover, swaps it for a shopping bag and hangs both handles on a free hook under the Penny Dish. Winner: Number Four first over the line with four pennies in the bucket and four bags hanging correctly.",
            CircleAtChangeover),

        new Entry("Quoits and Cone", "Equipment",
            "Ring four quoits and a tennis ball onto a cone level with Pole 1.",
            "Ball Cone level with Pole 1; three quoits and a tennis ball in a circle 3 m beyond the Changeover. Number One (carrying a quoit) places it over the cone, then collects another quoit dismounted at the Changeover and hands it on. Numbers 2 and 3 add a quoit each. Number Four collects the tennis ball and places it on top of the cone on the way back. Quoits must be fully over the cone; tennis ball correctly placed.",
            TableAtPole1AndChangeover),

        new Entry("Fishing Race", "Other",
            "Hook plastic fish from a bin and hand them to Number Five for hanging on a gibbet.",
            "Bin with four fish on the Centre Line; Number Five 3 m beyond the Changeover holding a gibbet (hooks facing down the arena). Each rider in turn rides up carrying a hooked cane, hooks a fish from the bin and rides on; Number Five unhooks it and secures it on the gibbet. Rider waits behind the Changeover until placement is complete, then rides back to hand the cane on. Cane has a 10 cm rubber stopper near the hook for safety. Winner: Number Four first over the line with all four fish on the gibbet.",
            FishingSetup),

        new Entry("Rosette Row", "Other",
            "Five-rider race — hook rosettes from a bin and hand them to Number Five to spell PGUK.",
            "Bin on the Centre Line containing four coloured rosettes (Blue P at 12, Red G at 3, Green U at 6, Yellow K at 9); Number Five 3 m beyond the Changeover holding a gibbet. Each rider hooks any rosette, rides on and waits behind the Changeover while Number Five places it on the correct hook so the gibbet spells P G U K left-to-right from the Start/Finish view. Dropped rosettes may be retrieved.",
            FishingSetup),

        // ── Zone 2026 sponsored aliases ───────────────────────────────────
        // Same rules/diagrams as the canonical races above, but listed with
        // the sponsor-branded names used by Zone 2026 race cards.
        new Entry("Hollywood Bowl Boule & Bucket", "Zone 2026 · Ball",
            "Zone 2026 sponsored name for Boule and Bucket.",
            "Four plastic boules per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Each rider in turn drops a boule in the bucket on the way up, dismounts at the Changeover to collect another and brings it back. Number Four drops the last on the way back. Winner: first Number Four over the line with 5 boules in the bucket.",
            ConeMidAndChangeover),

        new Entry("Hollywood Bowl Old Sock", "Zone 2026 · Equipment",
            "Zone 2026 sponsored name for Old Sock.",
            "Four sock-balls in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a sock) drops it in the bucket, rides on, dismounts, picks up another sock and brings it back. Numbers 2, 3 and 4 repeat. Number Four drops the last sock on the way back. Winner: first Number Four over the line with 5 socks in the bucket.",
            ConeMidAndChangeover),

        new Entry("Tally Ho Farm Ball & Socket", "Zone 2026 · Ball",
            "Zone 2026 sponsored name for Ball and Socket.",
            "Four Ball Cones level with Poles 1–4, each holding a tennis ball; a Bending Pole topped with a 4-socket Socket Board 3 m beyond the Changeover. Each rider in turn carries a ball, places it into a socket, then collects a ball from any cone on the way back. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball.",
            FourConesAtPoles),

        new Entry("PGSports UK Shopping Spree", "Zone 2026 · Other",
            "Zone 2026 sponsored name for the Shopping Spree race.",
            "Bending pole on the Centre Line topped with a Penny Dish that has four hooks underneath; four pennies stacked in the dish. Table 3 m beyond the Changeover holding a bucket with four branded shopping bags (each containing a Junior bottle). Each rider in turn carries a penny to Number Five at the Changeover, swaps it for a shopping bag and hangs both handles on a free hook under the Penny Dish. Winner: Number Four first over the line with four pennies in the bucket and four bags hanging correctly.",
            CircleAtChangeover),

        new Entry("STRUK Pole (JV)", "Zone 2026 · Letter Pole",
            "Junior version of STRUK Pole — same rules, fewer cartons.",
            "Junior version of STRUK Pole. Bending pole level with Pole 1; cartons in a circle 3 m beyond the Changeover with letters S, T, R, U, K plus blanks. Riders take turns slotting their carton (and bringing back the next). Final order top-to-bottom: S, T, R, U, K, blank, blank, blank.",
            LetterPole),

        new Entry("Spell EGUK (JV)", "Zone 2026 · Spelling",
            "Junior version of Spell EGUK — same rules.",
            "Junior version of Spell E G U K. Table on the Centre Line with eight cards (four letters E, G, U, K and four with the EGUK logo). Gibbet 3 m beyond the Changeover with two crossbars of four hooks each. Each of the four riders collects two cards in turn and hangs them on the correct hooks so the top row spells EGUK and the bottom row shows logos.",
            SpellTableAndGibbet),

        new Entry("EGUK Mug Changes", "Zone 2026 · Mug",
            "Zone 2026 sponsored name for Mug Changes.",
            "Four Bending Poles 7–9 m apart, mugs on Poles 2 and 4. Riders 1 & 3 start at Start/Finish; 2 & 4 at Changeover. Number One (carrying a mug) places on Pole 1, picks from Pole 2 and places on Pole 3, picks from Pole 4 and hands to Number Two. Pattern reverses going back. Mugs must be placed in correct order — any error must be corrected before continuing. Winner: Number Four first over the line, mounted, with mugs on Poles 2 and 4.",
            FourPoles),

        new Entry("2 Flag", "Zone 2026 · Flag",
            "Zone 2026 name for Two Flag — the standard run-off race.",
            "Two Flag Cones per team level with Poles 1 and 4; flag starts in the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries a flag, places it in one cone and collects from the other. Knocked cones must be reset immediately by the rider. Winner: Number Four first over the line carrying a flag.",
            """[{"t":"cone","x":17,"label":"Flag"},{"t":"cone","x":83,"label":"Flag"}]"""),

        new Entry("5 Flag", "Zone 2026 · Flag",
            "Zone 2026 name for Five Flag.",
            "Flag Cone 3 m behind the Changeover and another on the Centre Line; five flags — four start in the centre cone, one carried by Number One. Each rider in turn places their flag in the Changeover cone and brings one back from the centre cone. Winner: Number Four first over the line carrying a flag, with four flags in the Changeover cone.",
            ThreeFlagCones),

        // ── Area 2026 sponsored aliases + junior variants ─────────────────
        // Used by area-level competitions; mostly the same rules with different
        // sponsor names, plus dedicated junior versions where the rules differ.
        new Entry("5 Mug", "Area 2026 · Mug",
            "Area 2026 name for Five Mug – Pole Specific.",
            "Five Bending Poles 7–9 m apart; table 3 m behind Changeover with four inverted mugs (one with EGUK logo at front-left). Each rider places a mug on the designated pole (2, 3, 4 in turn) and brings back another mug. Number Four places on Pole 5, collects the EGUK mug, and places it on Pole 1 on the way back. Mugs must be replaced inverted. Winner: Number Four first over the line with a mug on every pole and the EGUK mug on Pole 1.",
            FivePoles),

        new Entry("2 Mug", "Area 2026 · Mug",
            "Area 2026 name for Two Mug.",
            "Four Bending Poles 7–9 m apart; mugs on Poles 1 and 3. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves Mug from 1→2 then 3→4, then crosses Changeover. Number Two moves Mug from 4→3 then 2→1, then crosses Start/Finish. Numbers 3 & 4 repeat. Mugs must move in the correct sequence — any error must be corrected. Winner: Number Four first over the line with mugs on Poles 1 and 3.",
            FourPoles),

        new Entry("PGUK Pyramid", "Area 2026 · Equipment",
            "Area 2026 name for Pyramid – PGUK Version.",
            "Table on the Centre Line and another 3 m beyond the Changeover. The Changeover table holds four unstacked 500 g plastic boxes lettered K, U, G, P (front-right, back-right, back-left, front-left as viewed from Start/Finish). Number One collects K and places it on the centre table; Number Two adds U; Number Three adds G; Number Four adds P. Stack must spell P G U K top-to-bottom. Boxes can be adjusted before/after placing.",
            TableMidlineAndChangeover),

        new Entry("PGUK Pyramid (junior version)", "Area 2026 · Equipment",
            "Junior version of PGUK Pyramid — same stacking pattern with the JV equipment set.",
            "Junior version of Pyramid – PGUK Version. Table on the Centre Line and another 3 m beyond the Changeover. JV equipment set. Stack must spell P G U K top-to-bottom.",
            TableMidlineAndChangeover),

        new Entry("Hollywood Bowl Bottle", "Area 2026 · Bottle",
            "Area 2026 sponsored name for Bottle.",
            "Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. A 750 ml bottle weighing 500 g sits on the Changeover table; another similar bottle is carried by Number One. Each rider in turn places one bottle on the centre table, collects the other from the Changeover table and hands it on. Knocked bottles/tables must be replaced upright. Winner: Number Four first over the line, mounted, carrying the bottle.",
            TableMidlineAndChangeover),

        new Entry("Hollywood Bowl Bottle (junior version)", "Area 2026 · Bottle",
            "Junior version of Hollywood Bowl Bottle.",
            "Junior version. Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. JV bottle weight. Each rider in turn places one bottle on the centre table, collects the other and hands it on. Winner: Number Four first over the line carrying the bottle.",
            TableMidlineAndChangeover),

        new Entry("Old Sock (junior version)", "Area 2026 · Equipment",
            "Junior version of Old Sock.",
            "Junior version. Four sock-balls in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a sock) drops it in the bucket, rides on, dismounts, picks up another sock and brings it back. Numbers 2, 3 and 4 repeat. Number Four drops the last sock on the way back. Winner: first Number Four over the line with 5 socks in the bucket.",
            ConeMidAndChangeover),

        new Entry("EGUK 5 Flag", "Area 2026 · Flag",
            "Area 2026 sponsored name for 5 Flag / Five Flag.",
            "Flag Cone 3 m behind the Changeover and another on the Centre Line; five flags — four start in the centre cone, one carried by Number One. Each rider in turn places their flag in the Changeover cone and brings one back from the centre cone. Winner: Number Four first over the line carrying a flag, with four flags in the Changeover cone.",
            ThreeFlagCones),
    };
}
