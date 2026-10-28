using MountedGames.Api.Entities;
using static MountedGames.Api.Services.RaceLibraryPairs;
using static MountedGames.Api.Services.RaceLibraryVariants;

namespace MountedGames.Api.Services;

/// <summary>
/// Individual versions: the pairs race ridden by one rider, with no handover. Not an
/// official Pony Club version, and the text says so. See <see cref="RaceLibraryVariants"/>.
///
/// How a pairs race is adapted:
///  - Both pair riders start at the Start/Finish End and each rides down and back: the
///    individual rides ONE such run, with the kit cut to what that run uses, and finishes
///    by putting in (or carrying over the line) the item the first rider would have handed on.
///  - Number One starts at the Start/Finish End and Number Two at the Changeover End: the
///    individual rides Number One's leg, carries straight on across the Changeover Line,
///    turns and rides Number Two's leg back to the Start/Finish Line. The kit is the
///    pairs kit.
///  - Pyramid, STRUK Pole, PGSPORTS Pole and Equipment Jumble only make sense with every
///    letter or item in place, so one rider rides the whole pairs course alone.
///
/// No Individual version (the team race is read instead):
///  - Bending: the course doesn't change for one rider.
///  - Bottle: one rider's run is exactly the team rider's run with the same kit.
///  - Big Sack, Three-Legged Sack, Rope, Grooms, Tyre, Hurdles: need a partner (or two
///    riders together, or a partner holding the pony).
///  - Bowling and Sharpshooters: one rider dismounts to throw while a partner holds the pony.
///  - Five Mug – Pole Specific: a lone rider can't fill five poles in a sensible run (and the
///    web lists treat 5 Mug as team-only).
///  - Rosette Row, Spell races, Postman's: need a Number Five (and Rosette Row is a team race).
/// </summary>
internal static class RaceLibraryIndividuals
{
    private const SectionFormat I = SectionFormat.Individual;

    /// <summary>Every Individual rules text opens with this sentence.</summary>
    internal const string Disclaimer = "Individual version, adapted from the Pony Club pairs rules for one rider. Not an official Pony Club race.";

    private static string Rules(string text) => $"{Disclaimer} {text}";

    public static readonly Variant[] All =
    [
        // ── One run, kit cut ──────────────────────────────────────────────────

        new("Ball and Bucket (Individual)", "Ball and Bucket", I,
            "Drop a tennis ball in the bucket on the Centre Line, fetch the second from the circle behind the Changeover and drop that in on the way back.",
            Rules("One Tennis Ball is placed in a marked circle 3 m behind the Changeover Line, and a Bucket stands on the Centre Line. The rider is mounted behind the Start/Finish Line. On the signal the rider, carrying a Tennis Ball, rides to the Bucket and drops the ball into it, then continues to the Changeover End, dismounts, picks up the ball from the circle, remounts and rides back, dropping it into the Bucket on the way. The winner is the first rider over the Start/Finish Line with two Tennis Balls in the Bucket. A Tennis Ball knocked out of the circle should be replaced by the Line Steward concerned. If the ball is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider must pick it up and carry it over the Changeover Line before mounting and continuing the race."),
            D.Make(4, true,
                D.Item("ball", "start"),
                D.Item("bucket", "gap2"),
                D.Item("ball", "beyond"))),

        new("Boule and Bucket (Individual)", "Boule and Bucket", I,
            "Drop a boule in the bucket on the Centre Line, fetch the second from the circle behind the Changeover and drop that in on the way back.",
            Rules("One plastic Boule is placed in a marked circle 3 m behind the Changeover Line, and a Bucket stands on the Centre Line. The rider is mounted behind the Start/Finish Line. On the signal the rider, carrying a Boule, rides to the Bucket and drops the Boule into it, then continues to the Changeover End, dismounts, picks up the Boule from the circle, remounts and rides back, dropping it into the Bucket on the way. The winner is the first rider over the Start/Finish Line with two Boules in the Bucket. A Boule knocked out of the circle should be replaced by the Line Steward concerned. If the Boule is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider must pick it up and carry it over the Changeover Line before mounting and continuing the race."),
            D.Make(4, true,
                D.Item("ball", "start", "Boule"),
                D.Item("bucket", "gap2"),
                D.Item("ball", "beyond", "Boule"))),

        new("Old Sock (Individual)", "Old Sock", I,
            "Drop a sock in the bucket on the Centre Line, fetch the second from the circle behind the Changeover and drop that in on the way back.",
            Rules("One sock sewn into a ball about the size of a fist is placed on the ground in a circle 3 m beyond the Changeover Line, and a Bucket stands on the Centre Line. The rider forms up behind the Start/Finish Line carrying a sock. On the signal the rider rides to the Bucket and drops the sock into it, then rides towards the Changeover Line, dismounts, picks up the sock from the circle, remounts and returns, dropping it into the Bucket on the way back. The winner is the first rider over the Start/Finish Line with two socks in the Bucket. Line Stewards may replace the sock in the circle where possible."),
            D.Make(4, true,
                D.Item("sock", "start"),
                D.Item("bucket", "gap2"),
                D.Item("sock", "beyond"))),

        new("Litter (Individual)", "Litter", I,
            "Spear two pieces of litter on a cane and drop them in the bin on the Centre Line.",
            Rules("Two identical pieces of Litter are placed side by side in a circle 3 m beyond the Changeover Line, with the open end facing the top of the arena so the rider can collect them on the turn or on the way back down. A Litter Bin stands on the Centre Line. The rider forms up mounted behind the Start/Finish Line, carrying a Cane. On the signal the rider rides to the Changeover End, picks up a piece of Litter on the Cane and returns to place it in the Litter Bin on the Centre Line using the Cane. The rider then rides back up the arena to the Changeover Line, collects the second piece of Litter, places it in the Litter Bin using the Cane and rides back over the Start/Finish Line. The winner is the first rider over the Start/Finish Line, mounted and carrying the Cane, with both pieces of Litter in the Litter Bin. The rider must stay mounted and must not hold the Litter by hand when picking it up, carrying it on the Cane or putting it in the Litter Bin. If a piece of Litter jams on the Cane, the rider may loosen it by hand before dropping it into the Litter Bin using the Cane. The rider may pick up either piece of Litter before re-crossing the Changeover Line, but once across it and into the field of play must keep the same piece. Litter dropped while trying to put it in the Litter Bin may be put in by hand, dismounted (see General Rules). Litter knocked out of the circle should be replaced by the Line Steward concerned. If a piece of Litter is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider must pick it up and carry it over the Changeover Line before continuing the race."),
            D.Make(4, true,
                D.Item("baton", "start", "Litter cane"),
                D.Item("bin", "gap2"),
                D.Reps(2, D.Item("mug", "beyond", "Litter")))),

        new("Fishing Race (Individual)", "Fishing Race", I,
            "Hook a fish from the bin on the Centre Line and drop it in the bin behind the Changeover.",
            Rules("A Bin holding one Fish is placed on the Centre Line, and another Bin is placed 3 m behind the Changeover Line in line with it. The rider forms up at the Start/Finish End with a Cane that has a small hook on one end. On the signal the rider rides to the Bin, hooks the Fish and continues over the Changeover Line, then either drops the Fish off the Cane into the Bin at the Changeover End or takes it off the Cane by hand and puts it in the Bin. The rider then rides back down the arena and across the Start/Finish Line. The winner is the first rider over the Start/Finish Line, carrying the Cane, with the Fish in the Bin at the Changeover End. A rider who drops the Fish while riding may pick it up, mounted or dismounted, and put it back on the hook of the Cane. A rider who drops the Fish while trying to put it in the Bin at the Changeover End may dismount, pick it up and drop it into the Bin from the ground. The Fish must be on the hook of the Cane whenever the rider is riding up the arena; if it is dropped, the rider must pick it up and carry on. The Cane has a rubber stopper 10 cm from the hook, so the Fish cannot slide up the Cane and hit the rider's fingers. If the Fish does go up the Cane, the rider must stop and get it back on the hook before going on."),
            D.Make(4, true,
                D.Item("baton", "start", "Fishing cane"),
                D.Item("bin", "gap2", on: [D.Kid(null, "Fish")]),
                D.Item("bin", "beyond"))),

        new("Five Flag (Individual)", "Five Flag", I,
            "Move two flags from a cone on the Centre Line to a cone behind the Changeover, then finish carrying the third.",
            Rules("A Flag Cone is placed 3 m behind the Changeover Line and another on the Centre Line. The rider has three Flags on Canes: two in the Flag Cone on the Centre Line and one carried at the start. On the signal the rider, carrying a Flag, rides to the Changeover End and places it in the Flag Cone, then rides back and takes a Flag out of the Flag Cone on the Centre Line, rides back up the arena and places it in the Flag Cone at the Changeover End. The rider then rides back down the arena, collecting the last Flag from the Flag Cone on the Centre Line on the way, and crosses the Start/Finish Line carrying it. The winner is the first rider over the Start/Finish Line carrying the Flag, with two Flags in the Flag Cone at the Changeover End. If a Flag Cone is knocked over, the rider must put it up again, replacing any Flags that were in it. A rider who takes more than one Flag from the Flag Cone must put the extra one back. The rider may dismount to correct mistakes. If a Flag comes off the Cane, the stick alone may be used to finish the race. On windy days, rubber bands can be used to keep the Flags furled so they do not blow together."),
            D.Make(4, true,
                D.Item("flag", "start"),
                D.Cone("flag", "gap2", D.Rep(2, D.Kid("flag"))),
                D.Cone("flag", "beyond"))),

        new("Four Flag (Individual)", "Four Flag", I,
            "Move two flags from the Centre Line cone into the cones level with Poles 1 and 5.",
            Rules("Three Flag Cones are placed, one level with Pole 1, one on the Centre Line and one level with Pole 5. Two Flags are placed in the Flag Cone on the Centre Line. On the signal the rider rides to the Flag Cone on the Centre Line, picks up a Flag, rides to either of the other Flag Cones and places the Flag in it. The rider then returns to the Flag Cone on the Centre Line, picks up the other Flag, places it in either of the other Flag Cones and rides back to cross the Start/Finish Line. The winner is the first rider over the Start/Finish Line with the two Flags in the Flag Cones level with Poles 1 and 5 and the Flag Cone on the Centre Line empty. Flag Cones knocked over must be set up immediately by the rider. If a Flag comes off the Cane, the Cane alone may be used. On windy days, rubber bands may be used to keep the Flags furled."),
            D.Make(5, true,
                D.Cone("flag", "pole1"),
                D.Cone("flag", "gap2", D.Rep(2, D.Kid("flag"))),
                D.Cone("flag", "pole5"))),

        new("Ball and Socket (Individual)", "Ball and Socket", I,
            "Place two balls in a socket board behind the Changeover, collecting from the cones on the way back.",
            Rules("Two Ball Cones are placed level with Poles 1 and 4, with a Tennis Ball on top of each. A Bending Pole topped with a Socket Board, with four sockets each large enough to hold a Tennis Ball, is placed 3 m beyond the Changeover Line. The rider, carrying a Tennis Ball, rides to the Changeover End and places it in one of the sockets. The rider then rides back down the arena, collects a Tennis Ball from either Ball Cone, rides over the Changeover Line and places it in one of the sockets. The rider then rides back down the arena, collecting the Tennis Ball from the other Ball Cone on the way, and crosses the Start/Finish Line carrying it. The winner is the first rider over the Start/Finish Line carrying the last Tennis Ball, with two Tennis Balls in the Socket Board. A rider who has made a genuine attempt to place a Tennis Ball in a socket but drops it may dismount and place it dismounted. A rider who knocks another Tennis Ball out of a socket must replace it, and may do so mounted or dismounted."),
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1", [D.Kid("ball")]),
                D.Cone("ball", "pole4", [D.Kid("ball")]),
                D.Item(null, "beyond", "Socket board"))),

        new("Bottle Collection (Individual)", "Bottle Collection", I,
            "Fill a bottle carrier with two bottles fetched from behind the Changeover and carry it over the line.",
            Rules("A Table is placed in line with Pole 1 and another, in line with the first, 3 m beyond the Changeover Line. Two plastic Bottles, weighted with sand, stand on the Table at the Changeover End. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a plastic Bottle Carrier, rides to the Table level with Pole 1 and places the Bottle Carrier upright on it. The rider then rides to the Changeover End, picks up a Bottle from the Table there, returns to place it upright in the Bottle Carrier, rides back to the Changeover End, collects the other Bottle, returns to place it in the Bottle Carrier, then picks up the Bottle Carrier and carries it across the Start/Finish Line. The winner is the first rider over the Start/Finish Line carrying the Bottle Carrier with two Bottles in it. Any Bottle knocked over must be replaced upright. The Bottle Carrier must be held by the handle when the rider places it on the Table and when picking it up and carrying it across the Start/Finish Line."),
            D.Make(4, false,
                D.Item("box", "start", "Bottle carrier"),
                D.Table("pole1"),
                D.Table("beyond", D.Rep(2, D.Kid("bottle"))))),

        new("Farmers' Market (Individual)", "Farmers' Market", I,
            "Put a milk bottle and a potato in a tack box tray, then carry the tray over the line.",
            Rules("A Table is placed level with Pole 1. Two items, a Bottle of Milk (upright) and a Potato, are placed in a circle on the ground 3 m behind the Changeover Line. The rider lines up at the Start/Finish End. On the signal the rider, carrying a Tack Box Tray, rides to the Table and places the Tray on it. The rider then rides to the Changeover End, dismounts, picks up the Bottle, remounts and returns to place it in the Tray, then rides back to the Changeover End, dismounts, picks up the Potato and rides to place it in the Tray. The rider then picks up the Tray with both items in it and carries it across the Start/Finish Line. The winner is the first rider over the Start/Finish Line carrying the Tray with the Bottle and the Potato in it. The Bottle must be placed upright in the Tray but does not have to stay upright once the rider has collected the Tray. The Bottle must stay upright while it is in the circle and when it is placed in the Tray, until the rider collects the Tray. The Potato, if knocked out of the circle, should be replaced by the Line Steward concerned."),
            D.Make(4, false,
                D.Item("box", "start", "Tack box tray"),
                D.Table("pole1"),
                D.Item("bottle", "beyond", "Milk bottle"),
                D.Item(null, "beyond", "Potato"))),

        new("Tack Shop (Individual)", "Tack Shop", I,
            "Carry a coin to the penny dish, put two tack items in a grooming tray and collect the coin.",
            Rules("A Bending Pole topped with a Penny Dish is erected level with Pole 1. A plastic Grooming Tray is placed on a Table level with Pole 4. A second Table is placed 3 m behind the Changeover Line, holding two of the Tack Shop items, for example a Dandy Brush and a Tail Bandage. The rider carries a Coin (10 cm diameter). On the signal the rider rides and places the Coin in the Penny Dish, then rides across the Changeover Line, collects either item from the Table, places it in the Grooming Tray, rides back over the Changeover Line, collects the other item and places it in the Grooming Tray. The rider then rides to the Penny Dish, collects the Coin and rides across the Start/Finish Line. If a Table is knocked over or an item falls, the rider may dismount to replace it. The winner is the first rider over the Start/Finish Line carrying the Coin, with both items in the Grooming Tray on the Table level with Pole 4."),
            D.Make(4, false,
                D.Item("penny", "start"),
                D.Pole("pole1", on: [D.Kid("penny", "Penny dish")]),
                D.Table("pole4", [D.Kid("box", "Grooming tray")]),
                D.Table("beyond", [D.Kid(null, "Dandy brush"), D.Kid(null, "Tail bandage")]))),

        new("Recycling Race (Individual)", "Recycling Race", I,
            "Post a bottle and a newspaper into a wheelie bin and close the lid.",
            Rules("A 120-litre Wheelie Bin with an Insert that has two slots, one circular and one rectangular, is placed in line with Pole 1 between two lines 50 cm apart. At the start the lid is closed, with the handles facing the Changeover End. A Bottle and a Newspaper are placed in any position on the ground in a circle 3 m behind the Changeover Line. The rider is mounted at the Start/Finish End. On the signal the rider rides up the arena to the Wheelie Bin, opens the lid and continues to the Changeover End. The rider dismounts, collects either item, remounts, returns to the Wheelie Bin and puts the item in through the correct slot: the Bottle through the circular hole, the Newspaper through the rectangular slot. The rider then returns to the Changeover End, collects the other item and returns to put it in the Wheelie Bin. After putting in the second item, the rider closes the lid before crossing the Start/Finish Line to end the race. The lid must stay open until the rider closes it after the second item. If the Wheelie Bin is knocked over or accidentally moved, the rider must put it back upright between the two lines, with the handles facing the Changeover End and the wheels not touching either line. Any item that has fallen out must be put back in, and the Insert in the top must be put back in the correct position so the lid can be closed fully. If the Insert is put back incorrectly and the rider does not correct it, the rider is eliminated. If the Wheelie Bin is knocked but does not fall over and ends up at a different angle, provided it is not touching either line the rider can carry on without moving it back to its original angle. Line Stewards will replace any items in the circle where it is safe to do so. The winner is the first rider over the Start/Finish Line after closing the lid on both items."),
            D.Make(4, false,
                D.Item("bin", "pole1", "Wheelie bin"),
                D.Item("bottle", "beyond"),
                D.Item("card", "beyond", "Newspaper"))),

        new("Post Box (Individual)", "Post Box", I,
            "Carry a coin to the penny dish, post a newspaper in the post box, then collect the coin and finish with it.",
            Rules("A Bending Pole topped with a Penny Dish is set up level with Pole 1. A Post Box stands on the Centre Line, and 3 m behind the Changeover Line is a Table holding a Newspaper. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Coin, rides to place the Coin in the Penny Dish, then rides across the Changeover Line, collects the Newspaper from the Table, rides back to the Post Box and posts the Newspaper through it. This must be done from the side nearer the Changeover Line, not by pulling it through from the other side. The rider then collects the Coin from the Penny Dish and rides across the Start/Finish Line. The winner is the first rider over the Start/Finish Line carrying the Coin. If the Post Box is knocked over, the rider must replace it. If it is knocked out of its original position, the rider may carry on as long as its feet are astride the Centre Line, as at the start, or at least one foot is touching the Centre Line. The Newspaper must not be folded at any time. The rider must make a genuine attempt to post the Newspaper while mounted, but if they have done so and drop it, they may dismount and post it on foot."),
            D.Make(4, true,
                D.Item("penny", "start"),
                D.Pole("pole1", on: [D.Kid("penny", "Penny dish")]),
                D.Item("box", "gap2", "Post box"),
                D.Table("beyond", [D.Kid("card", "Newspaper")]))),

        new("PG Sports Shopping Spree Race (Individual)", "PG Sports Shopping Spree Race", I,
            "Swap a penny from the dish for a shopping bag and hang it on a hook under the dish.",
            Rules("A Bending Pole topped with a Penny Dish, with four hooks on the underside, is erected on the Centre Line. The Penny Dish holds one Penny. In line with the Bending Pole, a Table is placed 3 m behind the Changeover Line, with a Bucket on it holding one branded canvas Shopping Bag, its handles hanging out of the Bucket. The Shopping Bag contains a Junior Bottle, which is part of the equipment. The rider lines up behind the Start/Finish Line. On the signal the rider rides to the Centre Line, collects the Penny from the Penny Dish, rides over the Changeover Line, puts the Penny in the Bucket and collects the Shopping Bag. The rider then rides back to the Penny Dish and hangs the Shopping Bag on any of the hooks under it, then rides back across the Start/Finish Line. Both handles of the Shopping Bag must be hung on the same hook. The winner is the first rider over the Start/Finish Line with the Penny in the Bucket and the branded Shopping Bag hanging correctly on a hook under the Penny Dish."),
            D.Make(4, true,
                D.Pole("gap2", on: [D.Kid("penny", "Penny dish"), D.Kid("penny")]),
                D.Table("beyond", [D.Kid("bucket", on: [D.Kid("sack", "Shopping bag"), D.Kid("bottle")])]))),

        new("HI LO – Cone Specific (Individual)", "HI LO – Cone Specific", I,
            "Put two balls into a high net behind the Changeover, collecting from Cones 4 and 3.",
            Rules("Two Ball Cones are placed level with Poles 3 and 4, with a Tennis Ball on top of each. Cone 4 is the one nearest the Changeover Line. A pole 2.13 m high, topped with a Net, is set up 3 m behind the Changeover Line in line with the Ball Cones. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Tennis Ball, rides beyond the Changeover Line, places the ball in the Net and returns down the arena to collect the Tennis Ball from the top of Cone 4. The rider then rides back up to the Changeover End and places that ball in the Net, then rides down the arena and across the Start/Finish Line, collecting the Tennis Ball from Cone 3 on the way. A Tennis Ball that misses the Net and falls to the ground may be picked up dismounted, but the rider must remount and put it in the Net from the mounted position. The rider may put the ball in the Net either by passing round the post or by going directly in front of it. The winner is the first rider over the Start/Finish Line carrying the last Tennis Ball, with two Tennis Balls in the Net. If a Tennis Ball falls when it is being collected from a Cone, or a Cone is knocked over, the rider must correct the error."),
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole3", [D.Kid("ball")]),
                D.Cone("ball", "pole4", [D.Kid("ball")]),
                D.Item(null, "beyond", "Hi-Lo net"))),

        new("Quoit and Bottle (Individual)", "Quoit and Bottle", I,
            "Stand a bottle on a table and ring it with two quoits fetched from behind the Changeover.",
            Rules("A Table is placed level with Pole 1. In line with it, two Rubber Quoits are placed on the ground in a circle marked 3 m beyond the Changeover Line. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Bottle (senior type, weighing 500 g), rides to the Table and places the Bottle upright on it. The rider then rides to the Changeover End, dismounts, collects a Quoit, remounts and returns to place the Quoit over the Bottle on the Table. The rider then rides back up the arena to the Changeover End, collects the second Quoit, places it over the Bottle in the same way and rides across the Start/Finish Line. If the Table or the Bottle is knocked over, or the Bottle is knocked off the Table, the rider must reset all the equipment before continuing. The winner is the first rider over the Start/Finish Line with the Bottle standing upright on the Table and two Quoits correctly placed over it. The Bottle must stay upright throughout the race, and the Quoits must be fully over the Bottle, not hanging from it."),
            D.Make(4, false,
                D.Item("bottle", "start"),
                D.Table("pole1"),
                D.Reps(2, D.Item("quoit", "beyond")))),

        new("Quoits and Cone (Individual)", "Quoits and Cone", I,
            "Place two quoits on a cone level with Pole 1, fetching the second from behind the Changeover.",
            Rules("A Ball Cone is placed level with Pole 1, in line with a circle marked on the ground 3 m beyond the Changeover Line. In the circle is one Rubber Quoit. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Quoit, rides to the Cone and places the Quoit over it, then rides to the Changeover End, dismounts, collects the Quoit from the circle, remounts, returns to place it over the Cone and rides over the Start/Finish Line. If the Cone is knocked over, the rider must reset all the equipment before continuing. A Line Steward will replace the Quoit in the circle, where possible, if a pony knocks it out. The winner is the first rider over the Start/Finish Line with two Quoits correctly placed on the Cone, fully over it."),
            D.Make(4, false,
                D.Item("quoit", "start"),
                D.Cone("ball", "pole1"),
                D.Item("quoit", "beyond"))),

        new("Tubular Flag Race (Individual)", "Tubular Flag Race", I,
            "Put a blue flag and a white flag into matching tubes of a flag holder behind the Changeover, then finish carrying the third.",
            Rules("A Four Flag Holder is placed 3 m behind the Changeover Line, and two White Flags are placed in a Flag Cone on the Centre Line. The rider is mounted behind the Start/Finish Line. On the signal the rider, carrying the BLUE PG LOGO FLAG, rides to the Changeover End and places the Flag in the matching centre blue tube of the Four Flag Holder. This must be done from the mounted position. The rider then rides back and collects a Flag from the Flag Cone on the Centre Line, rides back up the arena and places it in one of the other tubes. The rider then collects the other Flag from the Flag Cone on the Centre Line and crosses the Start/Finish Line carrying it. The winner is the first rider over the Start/Finish Line carrying the third Flag. If a rider knocks over the Four Flag Holder, the White Flag may be corrected from the ground, but the rider's own Flag must always be placed from the mounted position. At external shows and competitions, provided the first Flag is a different colour from the others, is placed in the centre tube and stays there, there is no need to use a blue Flag first or White Flags after it. The Chief Steward should say which colours of Flag will be used before the competition starts."),
            D.Make(4, true,
                D.Item("flag", "start", "Blue flag"),
                D.Cone("flag", "gap2", D.Rep(2, D.Kid("flag"))),
                D.Item(null, "beyond", "4-Flag holder"))),

        new("Three Mug (Individual)", "Three Mug", I,
            "Move three mugs one pole towards the Start/Finish Line.",
            Rules("Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 2, 3 and 4. The rider is mounted at the Start/Finish End. On the signal the rider rides down the arena, moves the Mug from Pole 2 to Pole 1, then the Mug from Pole 3 to Pole 2, then the Mug from Pole 4 to Pole 3, and rides back over the Start/Finish Line. Mugs must be moved in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the Pole it came from before correcting the first error. The winner is the first rider over the Start/Finish Line with Mugs on Poles 1, 2 and 3."),
            D.Make(4, false,
                D.Pole("pole1"),
                D.Pole("pole2", on: [D.Kid("mug")]),
                D.Pole("pole3", on: [D.Kid("mug")]),
                D.Pole("pole4", on: [D.Kid("mug")]))),

        // ── Both legs of the pairs race, no handover ──────────────────────────

        new("Mug Changes (Individual)", "Mug Changes", I,
            "Move mugs along the poles in sequence, up the arena and then back again.",
            Rules("Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 2 and 4. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Mug, rides to Pole 1 and places the Mug on it, collects the Mug from Pole 2 and places it on Pole 3, then collects the Mug from Pole 4 and carries it over the Changeover Line. The rider then turns, rides to Pole 4 and places the Mug on it, collects the Mug from Pole 3 and puts it on Pole 2, and finally collects the Mug from Pole 1 and rides across the Start/Finish Line with it. The winner is the first rider over the Start/Finish Line, mounted, carrying the Mug, with Mugs on Poles 2 and 4. Any Pole knocked over must be corrected by the rider and be upright at the end of the race. Mugs must be placed on each Pole in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the correct Pole before correcting the first error."),
            D.Make(4, false,
                D.Item("mug", "start"),
                D.Pole("pole1"),
                D.Pole("pole2", on: [D.Kid("mug")]),
                D.Pole("pole3"),
                D.Pole("pole4", on: [D.Kid("mug")]))),

        new("Two Mug (Individual)", "Two Mug", I,
            "Move two mugs along four poles, up the arena and then back again.",
            Rules("Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 1 and 3. The rider is mounted behind the Start/Finish Line. On the signal the rider rides down the arena, moves the Mug from Pole 1 to Pole 2, then the Mug from Pole 3 to Pole 4, and rides across the Changeover Line. The rider then turns, moves the Mug from Pole 4 to Pole 3, then the Mug from Pole 2 to Pole 1, and crosses the Start/Finish Line. The winner is the first rider over the Start/Finish Line with Mugs on Poles 1 and 3. Mugs must be placed on each Pole in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the correct Pole before correcting the first error."),
            D.Make(4, false,
                D.Pole("pole1", on: [D.Kid("mug")]),
                D.Pole("pole2"),
                D.Pole("pole3", on: [D.Kid("mug")]),
                D.Pole("pole4"))),

        new("Two Flag (Individual)", "Two Flag", I,
            "Place a flag in one cone and swap it for the flag in the other, up the arena and then back again.",
            Rules("Two Flag Cones are placed level with Poles 1 and 4, with a Flag in the Flag Cone level with Pole 4. The rider, carrying a Flag, is mounted behind the Start/Finish Line. On the signal the rider rides to the Flag Cone level with Pole 1 and places the Flag in it, then rides to the Flag Cone level with Pole 4, takes out the Flag and carries it across the Changeover Line. The rider then turns, rides to the Flag Cone level with Pole 4 and places the Flag in it, then rides to the Flag Cone level with Pole 1, takes out the Flag and rides across the Start/Finish Line. Flag Cones knocked over must be set up immediately by the rider. If a Flag comes off the Cane, the Cane alone may be used to complete the race. The winner is the first rider over the Start/Finish Line carrying a Flag."),
            D.Make(4, false,
                D.Item("flag", "start"),
                D.Cone("flag", "pole1"),
                D.Cone("flag", "pole4", [D.Kid("flag")]))),

        new("Ball and Cone (Individual)", "Ball and Cone", I,
            "Move a tennis ball between cones level with Poles 1 and 4, up the arena and then back again.",
            Rules("Two Ball Cones are placed level with Poles 1 and 4, with a Tennis Ball on the Ball Cone level with Pole 4. The rider is mounted behind the Start/Finish Line. On the signal the rider, carrying a Tennis Ball, rides to the Ball Cone level with Pole 1 and places the ball on it, then rides to the Ball Cone level with Pole 4, collects the ball and carries it across the Changeover Line. The rider then turns, rides to the Ball Cone level with Pole 4 and places the ball on it, then rides to the Ball Cone level with Pole 1, collects the ball and crosses the Start/Finish Line. The winner is the first rider over the Start/Finish Line carrying a Tennis Ball, with the other Tennis Ball on the Ball Cone level with Pole 4. If a cone is knocked over or a ball is dropped, the General Rules apply."),
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Cone("ball", "pole4", [D.Kid("ball")]))),

        new("Ball and Flag (Individual)", "Ball and Flag", I,
            "Place a ball on one cone and swap it for the flag in the other, up the arena and then back again.",
            Rules("A Ball Cone is placed level with Pole 1 and a Flag Cone level with Pole 4, with a Flag in the Flag Cone. The rider is mounted behind the Start/Finish Line. On the signal the rider, carrying a Tennis Ball, rides to the Ball Cone and places the Tennis Ball on it. The rider then rides to the Flag Cone, collects the Flag and carries it across the Changeover Line. The rider then turns, puts the Flag back in the Flag Cone, rides to collect the Tennis Ball and crosses the Start/Finish Line. The winner is the first rider over the Start/Finish Line carrying the Tennis Ball, with the Flag in the Flag Cone."),
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Cone("flag", "pole4", [D.Kid("flag")]))),

        new("Ball and Racquet (Individual)", "Ball and Racquet", I,
            "Balance a tennis ball on a racquet up and back through four bending poles.",
            Rules("A line of four Bending Poles is placed 7–9 m apart. The rider has a Tennis Racquet and a Tennis Ball and is mounted at the Start/Finish End. On the signal the rider, carrying the Tennis Ball on the head of the Racquet, rides up the arena through the Bending Poles and across the Changeover Line, then turns and rides in the same way back down the arena through the Bending Poles and across the Start/Finish Line. The Racquet has a crosspiece through the centre of the handle, and the rider's hand must be behind the crosspiece at all times during the race. The winner is the first rider over the Start/Finish Line."),
            D.Make(4, false,
                D.Item(null, "start", "Racquet", [D.Kid("ball")]),
                FourPoles())),

        new("Tennis Ball Shuffle (Individual)", "Tennis Ball Shuffle", I,
            "Move a tennis ball between a socket on the Centre Line and cones level with Poles 1 and 4, up the arena and then back again.",
            Rules("A pole topped with a socket holding a Tennis Ball at the 9 o'clock position, as viewed from the Start/Finish Line, is placed on the Centre Line. Ball Cones are placed level with Poles 1 and 4. The rider is mounted at the Start/Finish End. On the signal the rider, carrying a Tennis Ball, rides to the cone level with Pole 1 and places the ball on it. The rider then rides to the socket, removes the Tennis Ball, rides to the cone level with Pole 4, places it there and crosses the Changeover Line. The rider then turns, collects the Tennis Ball from the cone level with Pole 4 and places it in the socket at any position. The rider then rides to the cone level with Pole 1, removes the Tennis Ball and carries it across the Start/Finish Line. The winner is the first rider over the Start/Finish Line."),
            D.Make(4, true,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Pole("gap2", "Socket", [D.Kid("ball")]),
                D.Cone("ball", "pole4"))),

        new("Sword (Individual)", "Sword", I,
            "Collect four rings from the poles on a sword, two on the way up and two on the way back.",
            Rules("A line of four Bending Poles is erected about 7–9 m apart. A plastic Sword Ring with a 100 mm hole is placed on each Pole and held with an elastic band. On Poles 1 and 2 the stem that holds the Ring is on the back edge of the Pole, and on Poles 3 and 4 it is on the front edge. The rider is mounted behind the Start/Finish Line. On the signal the rider, holding a Sword, rides up the arena, collects two Rings from the tops of any Poles using the Sword and rides over the Changeover Line. The rider then turns, rides down the arena, collects the other two Rings from the tops of the Poles using the Sword and rides over the Start/Finish Line. The winner is the first rider over the Start/Finish Line holding the Sword with all four Rings on it. The Sword must always be held behind its crossbar, with no part of the hand or fingers in front of it, throughout the race. If a Ring is knocked off a Pole or dropped, the rider may dismount and pick it up by hand. The rider may hold any Rings already on the Sword with their fingers to help collect others, but must go back to where the error happened and carry on holding the Sword behind the crossbar. To help with remounting, the rider may lean the Sword against a Pole and pick it up once mounted, but must again go back to where the error happened. There is no penalty if a Pole is knocked down."),
            D.Make(4, false,
                D.Item("sword", "start"),
                D.Pole("pole1", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole2", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole3", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole4", on: [D.Kid("quoit", "Sword ring")]))),

        new("Small Sack (Individual)", "Small Sack", I,
            "Dismount, climb into a sack and run or jump, leading your pony, up the arena, then do it again on the way back.",
            Rules("The rider carries a Sack and is mounted behind the Start/Finish Line. On the signal the rider rides forward and, before crossing the Centre Line, dismounts and gets into the Sack. Leading their pony, the rider then runs or jumps up the arena. Getting out of the Sack and remounting must be done beyond the Changeover Line. The rider then turns, rides forward and, before crossing the Centre Line, dismounts and gets into the Sack again, then, leading their pony, runs or jumps down the arena and over the Start/Finish Line. Riders must not try to get into the Sack until they have dismounted, and the top of the Sack must not be rolled down. Every effort should be made to hold the Sack above knee level throughout. The rider must be on their feet when crossing the line, and the pony must be led by the nearer rein only. The winner is the first rider over the Start/Finish Line, on their feet, in the Sack, leading their pony."),
            D.Make(4, true,
                D.Item("sack", "start"))),

        new("Stepping Stones (Individual)", "Stepping Stones", I,
            "Dismount and lead your pony across six stepping stones on the Centre Line, up the arena and then back again.",
            Rules("Six Stepping Stones are placed 30 cm apart, straddling the Centre Line in a straight line up and down the arena, between the lines of Bending Poles. The rider is mounted at the Start/Finish End. On the signal the rider rides to the Stepping Stones, dismounts and, leading their pony, steps on each stone in turn and then on to the ground with the opposite foot from the one used on the final stone, before remounting and riding across the Changeover Line. The rider then turns, rides back to the Stepping Stones and crosses them in the same way, then remounts and rides across the Start/Finish Line. If a pony or rider knocks over a Stepping Stone, or the rider steps on the ground while crossing the stones, the rider must reset any fallen stones and, in both cases, go back and cross all the stones again from the direction first attempted. When dismounted, the rider must lead the pony by the nearer rein throughout. The winner is the first rider over the Start/Finish Line."),
            D.Make(4, true,
                D.Item(null, "gap2", "Stepping stone", D.Rep(5, D.Kid(null, "Stepping stone"))))),

        // ── The whole pairs course, ridden by one rider ───────────────────────

        new("Equipment Jumble (Individual)", "Equipment Jumble", I,
            "Stack a pyramid box, quoit, mug and tennis ball on a table, fetching each from behind the Changeover in turn.",
            Rules("A Pyramid Box, a Quoit, a Mug and a Tennis Ball are placed in a marked circle 3 m behind the Changeover Line, and a Table is placed in line with the circle, level with Pole 1. The rider is mounted at the Start/Finish End. The stack needs all four items, so the rider rides the whole pairs course alone. On the signal the rider rides towards the Changeover End, dismounts, picks up the Pyramid Box, remounts and rides to place it on the Table. The rider then rides back to the Changeover End, dismounts, picks up the Quoit, remounts and rides to place it on top of the Pyramid Box. The rider repeats this for the Mug, placed open end up inside the Quoit, and then the Tennis Ball, placed inside the Mug, and then crosses the Start/Finish Line. All four items must stay stacked on the Table with the Tennis Ball inside the Mug. The Pyramid Box may be on the edge of the Table, the Quoit may overhang the edge of the Pyramid Box and the Mug may touch the Quoit at an angle. The winner is the first rider over the Start/Finish Line, mounted, with all four items correctly stacked on the Table."),
            D.Make(4, false,
                D.Table("pole1"),
                D.Item("box", "beyond", "Pyramid box"),
                D.Item("quoit", "beyond"),
                D.Item("mug", "beyond"),
                D.Item("ball", "beyond"))),

        new("Pyramid (Individual)", "Pyramid – PGUK Version", I,
            "Stack four lettered boxes on a table on the Centre Line to spell P G U K from the top, fetching each from behind the Changeover.",
            Rules("A Table is placed on the Centre Line and another 3 m behind the Changeover Line. On the second Table are four unstacked Plastic Boxes, each with a printed letter on each side. As you look from the Start/Finish Line they are placed K front right, U back right, G back left and P front left. The word needs all four letters, so the rider rides the whole pairs course alone. On the signal the rider rides to the Table behind the Changeover Line, collects the Plastic Box with the letter K and rides to place it on the Table on the Centre Line. The rider returns to the Table behind the Changeover Line for the letter U, then G, then P, placing each on the stack on the Table on the Centre Line, and then crosses the Start/Finish Line. After collecting a Plastic Box, the rider may adjust the stack by hand or with the Plastic Box before or after placing theirs on it. If a Table is knocked over or a Plastic Box falls, the rider may dismount to replace them. At the Changeover End the Plastic Boxes must be placed side by side in any order, not on top of each other. On the Centre Line Table they must be stacked upright and in the correct order. The winner is the first rider over the Start/Finish Line with all four Plastic Boxes stacked on the Centre Line Table, spelling P G U K from the top. Line Stewards will board only once an incorrect Plastic Box has been placed on the Table on the Centre Line."),
            D.Make(4, true,
                D.Table("gap2"),
                D.Table("beyond", D.Rep(4, D.Kid("box"))))),

        new("STRUK Pole (Individual)", "STRUK Pole", I,
            "Slot lettered cartons over a pole to spell S T R U K from the top, fetching them one at a time from behind the Changeover.",
            Rules("A Bending Pole is set up level with Pole 1, with three blank Cartons already on it, in line with a circle 3 m behind the Changeover Line. In the circle, placed randomly, are four individually marked Cartons with the letters S, T, R and U. The word needs every letter, so the rider rides the whole pairs course alone. On the signal the rider, carrying a Carton marked K, rides to the Bending Pole and slots the Carton over it. The rider continues to the Changeover End, dismounts, collects the Carton marked U, rides down the arena and slots it over the pole, and repeats this for the Cartons marked R, T and S in turn, then crosses the Start/Finish Line. The winner is the first rider over the Start/Finish Line with all the Cartons on the pole, reading from top to bottom S, T, R, U, K, blank, blank, blank. Cartons placed in the wrong order or the wrong way up must be corrected by the rider. The narrow neck of each Carton is the top."),
            D.Make(4, false,
                D.Item("box", "start", "Carton"),
                D.Pole("pole1", on: D.Rep(3, D.Kid("box", "Carton"))),
                D.Reps(4, D.Item("box", "beyond", "Carton")))),

        new("PGSPORTS Pole (Individual)", "PGSPORTS Pole", I,
            "Slot lettered cartons over a pole to spell PGSPORTS from the top, fetching them one at a time from behind the Changeover.",
            Rules("Four one-litre washing-up-liquid Cartons, marked P, G, S and P, are placed randomly in a circle marked on the ground 3 m beyond the Changeover Line. A Bending Pole is erected level with Pole 1, in line with the circle, with three blank Cartons marked R, T and S (reading from top to bottom) already on it. The word needs every letter, so the rider rides the whole pairs course alone. On the signal the rider, carrying a Carton marked O, rides to the Bending Pole and slots the Carton over it. The rider continues to the Changeover End, dismounts, collects the Carton marked P, remounts, returns to slot it over the pole, and repeats this for the Cartons marked S, G and P in turn, then rides over the Start/Finish Line. The winner is the first rider over the Start/Finish Line with all eight Cartons on the pole, reading PGSPORTS from the top to the bottom. Letters placed in the wrong order, or the wrong way up, must be corrected by the rider. Line Stewards may replace Cartons in the circle where possible."),
            D.Make(4, false,
                D.Item("box", "start", "Carton"),
                D.Pole("pole1", on: D.Rep(3, D.Kid("box", "Carton"))),
                D.Reps(4, D.Item("box", "beyond", "Carton")))),
    ];
}
