using System.Text;
using System.Text.Json;
using MountedGames.Api.Entities;
using static MountedGames.Api.Services.RaceLibraryVariants;

namespace MountedGames.Api.Services;

/// <summary>
/// Pony Club 2026 Pairs versions. See <see cref="RaceLibraryVariants"/>.
///
/// Each diagram holds the kit ONE pair (or, in the Individual file, one rider) needs, every
/// item once, in its starting place: what Number One carries at the start sits at
/// <c>start</c>, the items in the circle behind the Changeover at <c>beyond</c>, a table
/// or station is an <c>in</c>, and so on. The equipment list counts every element per lane.
///
/// Not here: Three Mug and Table (Pairs) is a pairs-only race and stays in
/// <see cref="RaceLibrarySeed.Core"/>. Boule and Bucket has no booklet text of its own
/// (the Zone 2026 pairs list uses it), so it is written from Ball and Bucket.
/// </summary>
internal static class RaceLibraryPairs
{
    private const SectionFormat P = SectionFormat.Pairs;

    internal const string BendingDiagram = RaceLibrarySeed.BendingDiagram;

    /// <summary>Builds the diagram JSON the same way the team diagrams in <see cref="RaceLibrarySeed"/> are written.</summary>
    internal static class D
    {
        // The official lane landmarks (anchors win over x when the diagram is read).
        private static readonly Dictionary<string, int> X = new()
        {
            ["start"] = 0, ["pole1"] = 17, ["pole2"] = 39, ["gap2"] = 50, ["pole3"] = 61,
            ["pole4"] = 83, ["pole5"] = 91, ["beyond"] = 96, ["changeover"] = 100, ["top"] = 100,
        };

        private const string MidlineJson = """{"t":"midline"}""";

        private static string Q(string s) => JsonSerializer.Serialize(s);

        private static string Node(string t, string? kind, string? label, string? anchor, string[]? on)
        {
            var sb = new StringBuilder().Append("{\"t\":").Append(Q(t));
            if (kind is not null) sb.Append(",\"kind\":").Append(Q(kind));
            if (label is not null) sb.Append(",\"label\":").Append(Q(label));
            if (anchor is not null) sb.Append(",\"anchor\":").Append(Q(anchor)).Append(",\"x\":").Append(X[anchor]);
            if (on is { Length: > 0 }) sb.Append(",\"on\":[").Append(string.Join(",", on)).Append(']');
            return sb.Append('}').ToString();
        }

        /// <summary>A whole diagram: the lane, the elements, then the Centre Line when it matters.</summary>
        public static string Make(int poles, bool midline, params string[] elements)
        {
            var all = new List<string> { $"{{\"t\":\"lane\",\"poles\":{poles}}}" };
            all.AddRange(elements);
            if (midline) all.Add(MidlineJson);
            return "[" + string.Join(",", all) + "]";
        }

        /// <summary>An item (mug, ball, bucket...) at a landmark; with no kind, the label names it.</summary>
        public static string Item(string? kind, string anchor, string? label = null, string[]? on = null)
            => Node("item", kind, label, anchor, on);

        /// <summary>An item stacked on a pole, cone, table or another item (no position of its own).</summary>
        public static string Kid(string? kind, string? label = null, string[]? on = null)
            => Node("item", kind, label, null, on);

        public static string Pole(string anchor, string? label = null, string[]? on = null)
            => Node("pole", null, label, anchor, on);

        public static string Poles(params string[] anchors) => string.Join(",", anchors.Select(a => Pole(a)));

        public static string Cone(string kind, string anchor, string[]? on = null)
            => Node("cone", kind, null, anchor, on);

        /// <summary>A table or station.</summary>
        public static string Table(string anchor, string[]? on = null)
            => Node("in", null, null, anchor, on);

        /// <summary>The same element n times, for an <c>on</c> list.</summary>
        public static string[] Rep(int n, string element) => Enumerable.Repeat(element, n).ToArray();

        /// <summary>The same element n times, as top-level elements for <see cref="Make"/>.</summary>
        public static string Reps(int n, string element) => string.Join(",", Rep(n, element));
    }

    /// <summary>The bending poles of a lane, as one run of elements for <see cref="D.Make"/>.</summary>
    internal static string FourPoles() => D.Poles("pole1", "pole2", "pole3", "pole4");

    internal static string FivePoles() => D.Poles("pole1", "pole2", "pole3", "pole4", "pole5");

    public static readonly Variant[] All =
    [
        new("Ball and Bucket (Pairs)", "Ball and Bucket", P,
            "Each rider drops a tennis ball in the bucket on the Centre Line, fetches another from the circle behind the Changeover and brings it back.",
            "Two Tennis Balls per Pair are placed in a marked circle 3 m behind the Changeover Line. A Bucket for each Pair stands on the Centre Line. Both riders are mounted behind the Start/Finish Line. On the signal Number One, carrying a Tennis Ball, rides to the Bucket and drops the ball into it, then continues to the Changeover End, dismounts, picks up a ball from the circle, remounts and returns to hand it to Number Two behind the Start/Finish Line. Number Two completes the course in the same way, dropping the last Tennis Ball into the Bucket on the way back. The winning Pair is the one whose Number Two is first over the Start/Finish Line with three Tennis Balls in the Bucket. Tennis Balls knocked out of the circle should be replaced by the Line Steward concerned. If a ball is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider collecting that ball must pick it up and carry it over the Changeover Line before mounting and continuing the race.",
            D.Make(4, true,
                D.Item("ball", "start"),
                D.Item("bucket", "gap2"),
                D.Reps(2, D.Item("ball", "beyond")))),

        new("Boule and Bucket (Pairs)", "Boule and Bucket", P,
            "Each rider drops a boule in the bucket on the Centre Line and fetches another from the circle behind the Changeover.",
            "Two plastic Boules per Pair are placed in a marked circle 3 m behind the Changeover Line. A Bucket for each Pair stands on the Centre Line. Both riders are mounted behind the Start/Finish Line. On the signal Number One, carrying a Boule, rides to the Bucket and drops the Boule into it, then continues to the Changeover End, dismounts, picks up a Boule from the circle, remounts and returns to hand it to Number Two behind the Start/Finish Line. Number Two completes the course in the same way, dropping the last Boule into the Bucket on the way back. The winning Pair is the one whose Number Two is first over the Start/Finish Line with three Boules in the Bucket. Boules knocked out of the circle should be replaced by the Line Steward concerned. If a Boule is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider collecting it must pick it up and carry it over the Changeover Line before mounting and continuing the race. The Pony Club 2026 booklet has no separate pairs text for this race, so it is the Ball and Bucket (Pairs) course ridden with plastic Boules, as in the Zone 2026 pairs list.",
            D.Make(4, true,
                D.Item("ball", "start", "Boule"),
                D.Item("bucket", "gap2"),
                D.Reps(2, D.Item("ball", "beyond", "Boule")))),

        new("Ball and Cone (Pairs)", "Ball and Cone", P,
            "Move a tennis ball between cones level with Poles 1 and 4, one rider each way.",
            "Each Pair has two Ball Cones, level with Poles 1 and 4, with a Tennis Ball on the Ball Cone level with Pole 4. Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One, carrying a Tennis Ball, rides to the Ball Cone level with Pole 1 and places the ball on it, then rides to the Ball Cone level with Pole 4, collects the ball and hands it to Number Two behind the Changeover Line. Number Two rides to the Ball Cone level with Pole 4 and places the ball on it, then rides to the Ball Cone level with Pole 1, collects the ball and crosses the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying a Tennis Ball, with the other Tennis Ball on the Ball Cone level with Pole 4. If a cone is knocked over or a ball is dropped, the General Rules apply.",
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Cone("ball", "pole4", [D.Kid("ball")]))),

        new("Ball and Flag (Pairs)", "Ball and Flag", P,
            "Place a ball on one cone and swap it for the flag in the other, one rider each way.",
            "Each Pair has a Ball Cone level with Pole 1 and a Flag Cone level with Pole 4, with a Flag in the Flag Cone. Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One, carrying a Tennis Ball, rides to the Ball Cone and places the Tennis Ball on it. Number One then rides to the Flag Cone, collects the Flag and hands it to Number Two behind the Changeover Line. Number Two puts the Flag back in the Flag Cone, rides to collect the Tennis Ball and crosses the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the Tennis Ball, with the Flag in the Flag Cone.",
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Cone("flag", "pole4", [D.Kid("flag")]))),

        new("Ball and Racquet (Pairs)", "Ball and Racquet", P,
            "Balance a tennis ball on a racquet through four bending poles, one rider each way.",
            "A line of four Bending Poles is placed 7–9 m apart. Each Pair has a Tennis Racquet and a Tennis Ball. Number One is mounted at the Start/Finish End and Number Two at the Changeover End. On the signal Number One, carrying the Tennis Ball on the head of the Racquet, rides up the arena through the Bending Poles and hands the Racquet to Number Two behind the Changeover Line. Number Two rides in the same way back down the arena and across the Start/Finish Line. Each Racquet has a crosspiece through the centre of the handle, and the rider's hand must be behind the crosspiece at all times during the race and at the Changeover. The winning Pair is the one whose Number Two crosses the Start/Finish Line first.",
            D.Make(4, false,
                D.Item(null, "start", "Racquet", [D.Kid("ball")]),
                FourPoles())),

        new("Ball and Socket (Pairs)", "Ball and Socket", P,
            "Place two balls each in a socket board behind the Changeover, collecting from the cones on the way back.",
            "A line of four Ball Cones is placed level with Poles 1, 2, 3 and 4, with a Tennis Ball on top of each. A Bending Pole topped with a Socket Board, with four sockets each large enough to hold a Tennis Ball, is placed 3 m beyond the Changeover Line. Number One, carrying a Tennis Ball, rides to the Changeover End and places it in one of the sockets. Number One then rides back down the arena, collects a Tennis Ball from any Ball Cone, rides over the Changeover Line and places it in one of the sockets. Number One then rides back down the arena to the Start/Finish End, collecting a Tennis Ball from any Ball Cone on the way, and hands it to Number Two behind the Start/Finish Line. Number Two repeats the actions of Number One, finishing by collecting the final Tennis Ball on the way back down the arena and riding across the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the last Tennis Ball. A rider who has made a genuine attempt to place a Tennis Ball in a socket but drops it may dismount and place it dismounted. A rider who knocks another Tennis Ball out of a socket must replace it, and may do so mounted or dismounted.",
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1", [D.Kid("ball")]),
                D.Cone("ball", "pole2", [D.Kid("ball")]),
                D.Cone("ball", "pole3", [D.Kid("ball")]),
                D.Cone("ball", "pole4", [D.Kid("ball")]),
                D.Item(null, "beyond", "Socket board"))),

        new("Bending (Pairs)", "Bending", P,
            "Each rider in turn weaves down and back through five bending poles and hands the baton to their partner.",
            "Five Bending Poles in a line 7–9 m apart. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Baton, rides down and back through the poles and hands the Baton to Number Two behind the Start/Finish Line. Number Two rides down and back through the poles in the same way. The winning Pair is the one whose Number Two crosses the Start/Finish Line first, mounted and carrying the Baton. A rider who knocks a pole down must replace it and resume from where it fell, bending either side. A missed pole can be corrected by going back to it and continuing on either side. Line Stewards signal only if a pole is broken or lying flat on the ground.",
            BendingDiagram),

        new("Bottle (Pairs)", "Bottle", P,
            "Swap a bottle between a table on the Centre Line and one behind the Changeover.",
            "Each Pair has two Tables, one on the Centre Line and the other 3 m beyond the Changeover Line. On the Table at the Changeover End stands a plastic 750 ml Bottle, filled with sand or similar to weigh 500 g. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a similar Bottle, rides to the Table on the Centre Line, places the Bottle upright on it, rides to the Changeover End, picks up the Bottle from the Table there and returns to hand it to Number Two behind the Start/Finish Line. Number Two rides to the Table at the Changeover End, places the Bottle upright on it, then rides back down the arena and across the Start/Finish Line, collecting the Bottle from the Table on the Centre Line on the way. The winning Pair is the one whose Number Two crosses the Start/Finish Line first, mounted and carrying the Bottle. A Bottle knocked over must be replaced upright.",
            D.Make(4, true,
                D.Item("bottle", "start"),
                D.Table("gap2"),
                D.Table("beyond", [D.Kid("bottle")]))),

        new("Bottle Collection (Pairs)", "Bottle Collection", P,
            "Fill a bottle carrier with four bottles fetched from behind the Changeover.",
            "Each Pair has two Tables, one in line with Pole 1 and the other, in line with the first, 3 m beyond the Changeover Line. Four plastic Bottles, weighted with sand, stand on the Table at the Changeover End. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a plastic Bottle Carrier, rides to the Table level with Pole 1 and places the Bottle Carrier upright on it. Number One then rides to the Changeover End, picks up a Bottle from the Table there, returns to place it upright in the Bottle Carrier, rides back to the Changeover End, collects another Bottle, returns to place it in the Bottle Carrier and rides across the Start/Finish Line. Number Two repeats the actions of Number One, except that after placing their second Bottle in the Bottle Carrier, Number Two picks up the Bottle Carrier and carries it across the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the Bottle Carrier with four Bottles in it. Any Bottle knocked over must be replaced upright. The Bottle Carrier must be held by the handle when Number One places it on the Table and when Number Two picks it up and carries it across the Start/Finish Line.",
            D.Make(4, false,
                D.Item("box", "start", "Bottle carrier"),
                D.Table("pole1"),
                D.Table("beyond", D.Rep(4, D.Kid("bottle"))))),

        new("Bowling Race (Pairs)", "Bowling", P,
            "Both ride to the Centre Line, one dismounts and bowls a boule to knock down two bottles behind the Changeover.",
            "Two full-size Bottles, each weighted with 500 g, are placed 30 cm apart in a circle 3 m beyond the Changeover Line. A Bucket holding eight weighted plastic Boules is placed in front of the Changeover Line. Both riders are mounted at the Start/Finish End. On the signal both ride down the arena and across the Centre Line, where one rider dismounts. While the mounted rider holds the pony, the dismounted rider runs to the Bucket and, from behind the Changeover Line, bowls or throws a Boule at the Bottles. Both Bottles must be knocked down, even if one Boule does it. The rider then runs back and remounts before crossing the Centre Line, and both riders ride back over the Start/Finish Line. If a Pair runs out of Boules, the rider concerned must run forward with the Bucket, collect any number of Boules and continue from behind the Changeover Line as before. Ponies must be led by the nearer rein throughout. The white hat band is worn by the rider who dismounted. When bowling or throwing, the rider's foot must not be touching the line. A Boule thrown with a foot on the line, whether it succeeds or not, must be thrown again when the Line Steward calls it. The first Pair back over the Start/Finish Line wins.",
            D.Make(4, true,
                D.Item("bucket", "top", on: D.Rep(8, D.Kid("ball", "Boule"))),
                D.Reps(2, D.Item("bottle", "beyond")))),

        new("Equipment Jumble (Pairs)", "Equipment Jumble", P,
            "Stack a pyramid box, quoit, mug and tennis ball on a table, two items each.",
            "A Pyramid Box, a Quoit, a Mug and a Tennis Ball are placed in a marked circle 3 m behind the Changeover Line, and a Table is placed in line with the circle, level with Pole 1. Both riders are mounted at the Start/Finish End. On the signal Number One rides towards the Changeover End, dismounts, picks up the Pyramid Box, remounts and rides to place it on the Table. Number One then rides back to the Changeover End, dismounts, picks up the Quoit, remounts, rides to place it on top of the Pyramid Box and crosses the Start/Finish Line. Number Two repeats this, collecting in turn the Mug, placed open end up inside the Quoit, and then the Tennis Ball, placed inside the Mug. All four items must stay stacked on the Table with the Tennis Ball inside the Mug. The Pyramid Box may be on the edge of the Table, the Quoit may overhang the edge of the Pyramid Box and the Mug may touch the Quoit at an angle. The winning Pair is the one whose Number Two is first over the Start/Finish Line, mounted, with all four items correctly stacked on the Table.",
            D.Make(4, false,
                D.Table("pole1"),
                D.Item("box", "beyond", "Pyramid box"),
                D.Item("quoit", "beyond"),
                D.Item("mug", "beyond"),
                D.Item("ball", "beyond"))),

        new("Farmers' Market (Pairs)", "Farmers' Market", P,
            "Build up a tack box tray of four market items, two items each.",
            "A Table is placed level with Pole 1. Each Pair has four items, a String of Sausages, a Potato, an Egg Box and a Bottle of Milk (upright), placed in a circle on the ground 3 m behind the Changeover Line. Both riders line up at the Start/Finish End. On the signal Number One, carrying a Tack Box Tray, rides to the Table and places the Tray on it. Number One then rides to the Changeover End, dismounts, picks up the Bottle, remounts and returns to place it in the Tray. Number One rides back to the Changeover End, dismounts, picks up the Potato, rides to place it in the Tray and then crosses the Start/Finish Line. Number Two rides to the Changeover End, dismounts, picks up the String of Sausages, remounts and returns to place it in the Tray, then rides back to the Changeover End, dismounts, picks up the Egg Box and rides to place it in the Tray. Having placed the Egg Box, Number Two picks up the Tray with all four items in it and carries it across the Start/Finish Line. The Bottle must be placed upright in the Tray but does not have to stay upright once Number Two has collected the Tray. The Sausages may hang over the edge of the Tray. The Bottle must stay upright while it is in the circle and when it is placed in the Tray, until Number Two collects the Tray. Items other than the Bottle that are knocked out of the circle should be replaced by the Line Steward concerned.",
            D.Make(4, false,
                D.Item("box", "start", "Tack box tray"),
                D.Table("pole1"),
                D.Item("bottle", "beyond", "Milk bottle"),
                D.Item(null, "beyond", "Potato"),
                D.Item(null, "beyond", "Sausages"),
                D.Item("box", "beyond", "Egg box"))),

        new("Fishing Race (Pairs)", "Fishing Race", P,
            "Hook a fish from the bin on the Centre Line and drop it in the bin behind the Changeover, one fish each.",
            "A Bin holding two Fish is placed on the Centre Line, and another Bin is placed 3 m behind the Changeover Line in line with it. Both riders form up at the Start/Finish End. Number One has a Cane with a small hook on one end. On the signal Number One rides to the Bin, hooks a Fish and continues over the Changeover Line, then either drops the Fish off the Cane into the Bin at the Changeover End or takes it off the Cane by hand and puts it in the Bin. Number One then rides back down the arena and hands the Cane to Number Two behind the Start/Finish Line. Number Two repeats the actions of Number One. The winning Pair is the one whose Number Two is first across the Start/Finish Line with both Fish in the Bin at the Changeover End. A rider who drops a Fish while riding may pick it up, mounted or dismounted, and put it back on the hook of the Cane. A rider who drops a Fish while trying to put it in the Bin at the Changeover End may dismount, pick it up and drop it into the Bin from the ground. The Fish must be on the hook of the Cane whenever the rider is riding up the arena; if it is dropped, the rider must pick it up and carry on. The Cane has a rubber stopper 10 cm from the hook, so the Fish cannot slide up the Cane and hit the rider's fingers. If the Fish does go up the Cane, the rider must stop and get it back on the hook before going on.",
            D.Make(4, true,
                D.Item("baton", "start", "Fishing cane"),
                D.Item("bin", "gap2", on: D.Rep(2, D.Kid(null, "Fish"))),
                D.Item("bin", "beyond"))),

        new("Five Flag (Pairs)", "Five Flag", P,
            "Move four flags from a cone on the Centre Line to a cone behind the Changeover, two each.",
            "A Flag Cone is placed 3 m behind the Changeover Line and another on the Centre Line. Each Pair has five Flags on Canes. Four are in the Flag Cone on the Centre Line and one is carried by Number One at the start. On the signal Number One, carrying a Flag, rides to the Changeover End and places it in the Flag Cone, then rides back and takes a Flag out of the Flag Cone on the Centre Line, rides back up the arena and places it in the Flag Cone at the Changeover End. Number One then rides back down the arena, collecting a Flag from the Flag Cone on the Centre Line on the way, and hands it to Number Two behind the Start/Finish Line. Number Two completes the course in the same way, so that at the end the Pair has placed four Flags in the Flag Cone at the Changeover End and Number Two crosses the Start/Finish Line mounted, carrying a Flag. If a Flag Cone is knocked over, the rider must put it up again, replacing any Flags that were in it. A rider who takes more than one Flag from the Flag Cone must put the extra one back. Riders may dismount to correct mistakes. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the Flag. If a Flag comes off the Cane, the stick alone may be used to finish the race. On windy days, rubber bands can be used to keep the Flags furled so they do not blow together.",
            D.Make(4, true,
                D.Item("flag", "start"),
                D.Cone("flag", "gap2", D.Rep(4, D.Kid("flag"))),
                D.Cone("flag", "beyond"))),

        new("Five Mug – Mug Specific (Pairs)", "Five Mug – Pole Specific", P,
            "Put a mug on each of five poles, fetching them from a table behind the Changeover.",
            "A line of five Bending Poles is put up 7–9 m apart, with Pole 1 nearest the Start/Finish Line. A Table is placed 3 m behind the Changeover Line. Both riders are mounted at the Start/Finish End. Each Pair has five Mugs: four are placed inverted on the Table at the Changeover End and one is carried by Number One at the start. On the signal Number One, carrying the Mug, rides to Pole 2 and places the Mug inverted on top of it, rides to the Table, picks up another Mug and returns to place it on Pole 3. Number One then rides back to the Table, picks up another Mug and returns to hand it to Number Two behind the Start/Finish Line. Number Two rides to Pole 4 and places the Mug inverted on top of it, rides back to the Table, picks up another Mug and returns to place it on Pole 5. Number Two then rides back to the Table, picks up the final Mug and rides down the arena and across the Start/Finish Line, putting the Mug on top of Pole 1 on the way. The winning Pair is the one whose Number Two is first over the Start/Finish Line with a Mug on each Pole. The riders may ride straight and need not bend through the poles. Any Mug knocked off the Table must always be replaced inverted by the rider concerned.",
            D.Make(5, false,
                D.Item("mug", "start"),
                FivePoles(),
                D.Table("beyond", D.Rep(4, D.Kid("mug"))))),

        new("Four Flag (Pairs)", "Four Flag", P,
            "Move four flags from the Centre Line cone into the cones level with Poles 1 and 5, two each.",
            "Each Pair has three Flag Cones, one level with Pole 1, one on the Centre Line and one level with Pole 5. Four Flags are placed in the Flag Cone on the Centre Line. On the signal Number One rides to the Flag Cone on the Centre Line, picks up a Flag, rides to either of the other Flag Cones and places the Flag in it. Number One then returns to the Flag Cone on the Centre Line, picks up another Flag, places it in either of the other Flag Cones and rides back to cross the Start/Finish Line. Number Two does the same with the final two Flags and rides back to cross the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line with two Flags in each of the Flag Cones level with Poles 1 and 5, leaving the Flag Cone on the Centre Line empty. Flag Cones knocked over must be set up immediately by the rider concerned. If a Flag comes off the Cane, the Cane alone may be used. On windy days, rubber bands may be used to keep the Flags furled.",
            D.Make(5, true,
                D.Cone("flag", "pole1"),
                D.Cone("flag", "gap2", D.Rep(4, D.Kid("flag"))),
                D.Cone("flag", "pole5"))),

        new("Grooms (Pairs)", "Grooms", P,
            "One rider leads their partner's pony through the poles, hands it over and the partner rides back leading theirs.",
            "Four Bending Poles are placed in a line 7–9 m apart. Number One is mounted at the Start/Finish End, holding Number Two's pony. Number Two is on foot at the Changeover End. On the signal Number One rides through the Bending Poles leading Number Two's pony. On crossing the Changeover Line Number One dismounts and hands Number Two's pony to Number Two, who mounts. Number One then hands their own pony to Number Two. Number Two rides back through the Bending Poles and across the Start/Finish Line, leading Number One's pony. A rider who lets go of the pony they are leading must regain hold of it and resume the race from the point where the fault occurred. Once the handover is complete, the incoming rider may not cross the Changeover Line again to give a lead or encouragement. Ponies must be led by the rein nearer the ridden pony, and no other part of the bridle may be held at any time. The first Pair over the Start/Finish Line wins.",
            D.Make(4, false, FourPoles())),

        new("HI LO – Cone Specific (Pairs)", "HI LO – Cone Specific", P,
            "Put four tennis balls into a high net behind the Changeover, collecting from the cones in order.",
            "A line of four Ball Cones is placed 7–9 m apart, level with Poles 1, 2, 3 and 4, with a Tennis Ball on top of each. Cone 1 is nearest the Start/Finish Line and Cone 4 nearest the Changeover Line. A pole 2.13 m high, topped with a Net, is set up 3 m behind the Changeover Line in line with the row of Ball Cones. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Tennis Ball, rides beyond the Changeover Line, places the ball in the Net and returns down the arena to collect the Tennis Ball from the top of Cone 4. Number One then rides back up to the Changeover End and places that ball in the Net, rides down the arena and across the Start/Finish Line, collecting the Tennis Ball from Cone 3 on the way and handing it to Number Two behind the Start/Finish Line. Number Two rides to the Changeover End, places the ball in the Net and returns down the arena to collect the Tennis Ball from Cone 2, then rides back up to the Changeover End and places it in the Net. Number Two then rides down the arena and across the Start/Finish Line, collecting the Tennis Ball from Cone 1 on the way. A Tennis Ball that misses the Net and falls to the ground may be picked up dismounted, but the rider must remount and put it in the Net from the mounted position. The rider may put the ball in the Net either by passing round the post or by going directly in front of it. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the last Tennis Ball, with four Tennis Balls in the Net. If a Tennis Ball falls when it is being collected from a Cone, or a Cone is knocked over, the rider must correct the error.",
            D.Make(4, false,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1", [D.Kid("ball")]),
                D.Cone("ball", "pole2", [D.Kid("ball")]),
                D.Cone("ball", "pole3", [D.Kid("ball")]),
                D.Cone("ball", "pole4", [D.Kid("ball")]),
                D.Item(null, "beyond", "Hi-Lo net"))),

        new("Hurdles (Pairs)", "Hurdles", P,
            "Each rider in turn steps over and crawls under four hurdles while their partner holds their pony.",
            "Four Hurdles are placed about 1.85 m apart in a straight line up and down the arena, straddling the Centre Line, alternately low and high when viewed from the Start/Finish Line. An inverted Mug is placed on each of the two higher Hurdles. Numbers One and Two form up mounted behind the Start/Finish Line. On the signal both ride towards the Hurdles. Number One dismounts and hands their pony to Number Two, then steps over the first Hurdle, crawls under the second, steps over the third and crawls under the fourth. Number One then remounts and both riders ride across the Changeover Line. The Pair then ride back to the Hurdles, where Number Two dismounts and hands their pony to Number One, then crawls under the first Hurdle, steps over the second, crawls under the third and steps over the fourth. Number Two then remounts and both riders ride over the Start/Finish Line. The rider who is to hold the pony at the Hurdles may take hold of its rein before, or as they ride down the arena. The pony must be led by the rein nearer the ridden pony and not by the bit ring or any other part of the bridle. If a Hurdle is knocked over or a Mug falls off, the rider concerned must replace it, go back to the first Hurdle and negotiate all the Hurdles again. Mugs must be replaced inverted and should have coloured tape around the lip to make them easier to judge. The winning Pair is the first across the Start/Finish Line mounted on their ponies.",
            D.Make(4, true,
                D.Item(null, "gap2", "Hurdle", [.. D.Rep(3, D.Kid(null, "Hurdle")), .. D.Rep(2, D.Kid("mug"))]))),

        new("Litter (Pairs)", "Litter", P,
            "Spear two pieces of litter each on a cane and drop them in the bin on the Centre Line.",
            "Four identical pieces of Litter per Pair are placed side by side in a circle 3 m beyond the Changeover Line, with the open end facing the top of the arena so riders can collect them on the turn or on the way back down. A Litter Bin for each Pair is placed on the Centre Line. Both riders form up mounted behind the Start/Finish Line. On the signal Number One, carrying a Cane, rides to the Changeover End, picks up a piece of Litter on the Cane and returns to place it in the Litter Bin on the Centre Line using the Cane. Number One then rides back up the arena to the Changeover Line, collects a second piece of Litter, places it in the Litter Bin using the Cane and rides back down the arena to hand the Cane to Number Two behind the Start/Finish Line. Number Two repeats the actions of Number One. The winning Pair is the one whose Number Two is first over the Start/Finish Line, mounted and carrying the Cane, with all four pieces of Litter in the Litter Bin. Riders must stay mounted and must not hold the Litter by hand when picking it up, carrying it on the Cane or putting it in the Litter Bin. If a piece of Litter jams on the Cane, the rider may loosen it by hand before dropping it into the Litter Bin using the Cane. A rider may pick up any piece of Litter in the pile before re-crossing the Changeover Line, but once across it and into the field of play must keep the same piece. Litter dropped while trying to put it in the Litter Bin may be put in by hand, dismounted (see General Rules). Litter knocked out of the circle should be replaced by the Line Steward concerned. If a piece of Litter is knocked into the field of play and the Line Steward cannot retrieve it safely, the rider collecting it must pick it up and carry it over the Changeover Line before continuing the race.",
            D.Make(4, true,
                D.Item("baton", "start", "Litter cane"),
                D.Item("bin", "gap2"),
                D.Reps(4, D.Item("mug", "beyond", "Litter")))),

        new("Mug Changes (Pairs)", "Mug Changes", P,
            "Move mugs along the poles in sequence, one rider each way.",
            "Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 2 and 4. Number One is mounted at the Start/Finish End and Number Two at the Changeover End. On the signal Number One, carrying a Mug, rides to Pole 1 and places the Mug on it, collects the Mug from Pole 2 and places it on Pole 3, and finally collects the Mug from Pole 4 and hands it to Number Two behind the Changeover Line. Number Two rides to Pole 4 and places the Mug on it, collects the Mug from Pole 3 and puts it on Pole 2, and finally collects the Mug from Pole 1 and rides across the Start/Finish Line with it. The winning Pair is the one whose Number Two is first over the Start/Finish Line, mounted, carrying the Mug, with Mugs on Poles 2 and 4. Any Pole knocked over must be corrected by the rider concerned and be upright at the end of the race. Mugs must be placed on each Pole in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the correct Pole before correcting the first error.",
            D.Make(4, false,
                D.Item("mug", "start"),
                D.Pole("pole1"),
                D.Pole("pole2", on: [D.Kid("mug")]),
                D.Pole("pole3"),
                D.Pole("pole4", on: [D.Kid("mug")]))),

        new("Old Sock (Pairs)", "Old Sock", P,
            "Each rider drops a sock in the bucket on the Centre Line and fetches another from the circle behind the Changeover.",
            "Each Pair has two socks sewn into balls about the size of a fist, placed on the ground in a circle 3 m beyond the Changeover Line. A row of Buckets, one for each Pair, is placed across the Centre Line. Both riders form up behind the Start/Finish Line. On the signal Number One, carrying a sock, rides to their Pair's Bucket and drops the sock into it, then rides towards the Changeover Line, dismounts, picks up a sock, remounts and returns across the Start/Finish Line to hand it to Number Two. Number Two completes the race in the same way, dropping the last sock into the Bucket on the way back. The winning Pair is the one whose Number Two is first over the Start/Finish Line with three socks in the Bucket. Line Stewards may replace socks in the circle where possible.",
            D.Make(4, true,
                D.Item("sock", "start"),
                D.Item("bucket", "gap2"),
                D.Reps(2, D.Item("sock", "beyond")))),

        new("PGSPORTS Pole (Pairs)", "PGSPORTS Pole", P,
            "Slot lettered cartons over a pole to spell PGSPORTS from the top, fetching them from behind the Changeover.",
            "Four one-litre washing-up-liquid Cartons, marked P, G, S and P, are placed randomly in a circle marked on the ground 3 m beyond the Changeover Line. A Bending Pole is erected level with Pole 1, in line with the circle, with three blank Cartons marked R, T and S (reading from top to bottom) already on it. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Carton marked O, rides to the Bending Pole and slots the Carton over it. Number One continues to the Changeover End, dismounts, collects the Carton marked P, remounts, returns to slot it over the pole, then returns to the Changeover End, dismounts, collects the Carton marked S, remounts and rides down the arena to hand it to Number Two behind the Start/Finish Line. Number Two rides to the Bending Pole and slots the Carton over it, continues to the Changeover End, dismounts, collects the Carton marked G, remounts and returns to slot it over the pole, and finally returns to the Changeover End, dismounts, collects the Carton marked P, remounts, returns to slot it over the pole and rides over the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line with all eight Cartons on the pole, reading PGSPORTS from the top to the bottom. Letters placed in the wrong order, or the wrong way up, must be corrected by the rider concerned. Line Stewards may replace Cartons in the circle where possible.",
            D.Make(4, false,
                D.Item("box", "start", "Carton"),
                D.Pole("pole1", on: D.Rep(3, D.Kid("box", "Carton"))),
                D.Reps(4, D.Item("box", "beyond", "Carton")))),

        new("PG Sports Shopping Spree Race (Pairs)", "PG Sports Shopping Spree Race", P,
            "Swap a penny from the dish for a shopping bag and hang it on a hook under the dish, one each.",
            "A Bending Pole topped with a Penny Dish, with four hooks on the underside, is erected on the Centre Line. The Penny Dish holds two Pennies stacked on top of each other. In line with the Bending Pole, a Table is placed 3 m behind the Changeover Line, with a Bucket on it holding two branded canvas Shopping Bags, their handles hanging out of the Bucket on opposite sides. Each Shopping Bag contains a Junior Bottle, which is part of the equipment. Number One lines up behind the Start/Finish Line and Number Two waits behind the 6 m line. On the signal Number One rides to the Centre Line, collects a Penny from the Penny Dish, rides over the Changeover Line, puts the Penny in the Bucket and collects one of the Shopping Bags. Number One then rides back to the Penny Dish and hangs the Shopping Bag on any of the hooks under it, then rides back across the Start/Finish Line. Both handles of the Shopping Bag must be hung on the same hook. Number Two repeats the actions of Number One, using a different hook for their Shopping Bag. If, after a rider has crossed the Start/Finish Line, a handle comes off its hook, the rider who is in the field of play at the time may replace the handle on the hook and carry on. The winning Pair is the one whose Number Two is first over the Start/Finish Line with two Pennies in the Bucket and two branded Shopping Bags hanging correctly on the hooks under the Penny Dish.",
            D.Make(4, true,
                D.Pole("gap2", on: [D.Kid("penny", "Penny dish"), .. D.Rep(2, D.Kid("penny"))]),
                D.Table("beyond", [D.Kid("bucket", on: [.. D.Rep(2, D.Kid("sack", "Shopping bag")), .. D.Rep(2, D.Kid("bottle"))])]))),

        new("Post Box (Pairs)", "Post Box", P,
            "Carry a coin to the penny dish, post a newspaper in the post box, then collect the coin and hand it on.",
            "A Bending Pole topped with a Penny Dish is set up level with Pole 1. A Post Box stands on the Centre Line, and 3 m behind the Changeover Line is a Table holding two Newspapers. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Coin, rides to place the Coin in the Penny Dish, then rides across the Changeover Line, collects a Newspaper from the Table, rides back to the Post Box and posts the Newspaper through it. This must be done from the side nearer the Changeover Line, not by pulling it through from the other side. Number One then rides to collect the Coin from the Penny Dish and hands it to Number Two behind the Start/Finish Line. Number Two completes the race in the same way. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the Coin. If the Post Box is knocked over, the rider concerned must replace it. If it is knocked out of its original position, the rider may carry on as long as its feet are astride the Centre Line, as at the start, or at least one foot is touching the Centre Line. The Newspaper must not be folded at any time. The rider must make a genuine attempt to post the Newspaper while mounted, but if they have done so and drop it, they may dismount and post it on foot. At Zone Finals and the Pony Club Championships the Post Box is 122 cm high (slot at 94 cm) and 41 cm wide, with a slot opening of 3 cm × 25 cm, and the Newspaper is a standard A4 (when flat) medical journal in a thin plastic sleeve or wallet.",
            D.Make(4, true,
                D.Item("penny", "start"),
                D.Pole("pole1", on: [D.Kid("penny", "Penny dish")]),
                D.Item("box", "gap2", "Post box"),
                D.Table("beyond", D.Rep(2, D.Kid("card", "Newspaper"))))),

        new("Pyramid (Pairs)", "Pyramid – PGUK Version", P,
            "Stack four lettered boxes on a table on the Centre Line to spell P G U K from the top, two each.",
            "A Table is placed on the Centre Line and another 3 m behind the Changeover Line. On the second Table are four unstacked Plastic Boxes, each with a printed letter on each side. As you look from the Start/Finish Line they are placed K front right, U back right, G back left and P front left. On the signal Number One rides to the Table behind the Changeover Line, collects the Plastic Box with the letter K and rides to place it on the Table on the Centre Line. Number One then returns to the Table behind the Changeover Line, collects the letter U, rides to place it on the Plastic Box already on the Table on the Centre Line and crosses the Start/Finish Line. Number Two, in the same way, collects the Plastic Box with the letter G and then the one with the letter P, placing each on the stack on the Table on the Centre Line. After collecting a Plastic Box, the rider may adjust the stack by hand or with the Plastic Box before or after placing theirs on it. If a Table is knocked over or a Plastic Box falls, the rider concerned may dismount to replace them. At the Changeover End the Plastic Boxes must be placed side by side in any order, not on top of each other. On the Centre Line Table they must be stacked upright and in the correct order. The winning Pair is the one whose Number Two is first over the Start/Finish Line with all four Plastic Boxes stacked on the Centre Line Table, spelling P G U K from the top. Line Stewards will board only once an incorrect Plastic Box has been placed on the Table on the Centre Line.",
            D.Make(4, true,
                D.Table("gap2"),
                D.Table("beyond", D.Rep(4, D.Kid("box"))))),

        new("Quoit and Bottle (Pairs)", "Quoit and Bottle", P,
            "Stand a bottle on a table and ring it with four quoits fetched from behind the Changeover, two each.",
            "A Table is placed level with Pole 1. In line with it, four Rubber Quoits are placed on the ground in a circle marked 3 m beyond the Changeover Line. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Bottle (senior type, weighing 500 g), rides to the Table and places the Bottle upright on it. Number One then rides to the Changeover End, dismounts, collects a Quoit, remounts and returns to place the Quoit over the Bottle on the Table. Number One then rides back up the arena to the Changeover End, collects a second Quoit, places it over the Bottle in the same way and rides across the Start/Finish Line. Number Two rides to the Changeover End, dismounts, collects a Quoit, remounts and returns to place it over the Bottle, then rides back up the arena to the Changeover End, collects the final Quoit, places it over the Bottle and rides across the Start/Finish Line. If the Table or the Bottle is knocked over, or the Bottle is knocked off the Table, the rider must reset all the equipment before continuing. The winning Pair is the one whose Number Two is first over the Start/Finish Line with the Bottle standing upright on the Table and four Quoits correctly placed over it. The Bottle must stay upright throughout the race, and the Quoits must be fully over the Bottle, not hanging from it.",
            D.Make(4, false,
                D.Item("bottle", "start"),
                D.Table("pole1"),
                D.Reps(4, D.Item("quoit", "beyond")))),

        new("Quoits and Cone (Pairs)", "Quoits and Cone", P,
            "Place four quoits and a tennis ball on a cone level with Pole 1, fetching them from behind the Changeover.",
            "A Ball Cone is placed level with Pole 1, in line with a circle marked on the ground 3 m beyond the Changeover Line. In the circle are three Rubber Quoits and a Tennis Ball. Both riders are mounted at the Start/Finish End. On the signal Number One, carrying a Quoit, rides to the Cone and places the Quoit over it, then rides to the Changeover End, dismounts, collects a Quoit, remounts, returns to place it over the Cone, rides back to the Changeover End, dismounts, collects another Quoit, remounts, rides over the Start/Finish Line and hands the Quoit to Number Two. Number Two repeats the actions of Number One, except that the second time they go to the Changeover End they dismount and collect the Tennis Ball instead of a Quoit, remount, ride to place it on top of the Cone and then ride over the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line with four Quoits and the Tennis Ball correctly placed on the Cone. If the Cone is knocked over, the rider must reset all the equipment before continuing. Line Stewards will replace any Quoits or the Tennis Ball in the circle, where possible, if a pony knocks them out. The Quoits must be fully over the Cone and the Tennis Ball correctly placed on top.",
            D.Make(4, false,
                D.Item("quoit", "start"),
                D.Cone("ball", "pole1"),
                D.Reps(3, D.Item("quoit", "beyond")),
                D.Item("ball", "beyond"))),

        new("Recycling Race (Pairs)", "Recycling Race", P,
            "Post four items of recycling into a wheelie bin, two each, and close the lid.",
            "A 120-litre Wheelie Bin with an Insert that has two slots, one circular and one rectangular, is placed in line with Pole 1 between two lines 50 cm apart. At the start the lid is closed, with the handles facing the Changeover End. Four items of recycling, a Bottle, a Tin Can, a Newspaper and a Letter, are placed in any position on the ground in a circle 3 m behind the Changeover Line. Both riders are mounted at the Start/Finish End. On the signal Number One rides up the arena to the Wheelie Bin, opens the lid and continues to the Changeover End. Number One dismounts, collects any item of recycling, remounts, returns to the Wheelie Bin and puts the item in through the correct slot: the Bottle and Tin Can through the circular hole, the Newspaper and Letter through the rectangular slot. Number One then returns to the Changeover End, collects a second item, returns to put it in the Wheelie Bin and rides across the Start/Finish Line. Number Two does the same with a third item, then returns for the final item and puts it in the Wheelie Bin. After putting in the final item, Number Two closes the lid before crossing the Start/Finish Line to end the race. Once Number One has opened the lid, it must stay open until Number Two closes it after the final item. If the Wheelie Bin is knocked over or accidentally moved, the rider responsible must put it back upright between the two lines, with the handles facing the Changeover End and the wheels not touching either line. Any items that have fallen out must be put back in, and the Insert in the top must be put back in the correct position so the lid can be closed fully. If the Insert is put back incorrectly and the rider concerned does not correct it, the Team is eliminated. Other riders may not correct the Insert if the rider who displaced it has put it back incorrectly. If the Wheelie Bin is knocked but does not fall over and ends up at a different angle, provided it is not touching either line the Team can carry on without moving it back to its original angle. Line Stewards will replace any items in the circle where it is safe to do so.",
            D.Make(4, false,
                D.Item("bin", "pole1", "Wheelie bin"),
                D.Item("bottle", "beyond"),
                D.Item(null, "beyond", "Tin can"),
                D.Item("card", "beyond", "Newspaper"),
                D.Item("card", "beyond", "Letter"))),

        new("Rope (Pairs)", "Rope", P,
            "Carry a rope between you through four bending poles: one rider takes it up, the other joins at the Changeover for the ride back.",
            "Four Bending Poles are erected about 7–9 m apart. Number One, carrying a rope about 90 cm long, is mounted at the Start/Finish End and Number Two is mounted at the Changeover End. The rope must not be looped or knotted at any time, and holding hands is not allowed. On the signal Number One rides up the arena weaving through the Bending Poles and crosses the Changeover Line, where Number Two takes hold of the rope, and both riders return through the Bending Poles and over the Start/Finish Line. Both riders must have hold of the rope before crossing back into the field of play at the Changeover Line. The winning Pair is the one that crosses the Start/Finish Line first, mounted and carrying the rope between them. If either rider lets go of the rope while in the field of play, the Pair must go back and resume the race from the point where the fault occurred.",
            D.Make(4, false,
                D.Item("baton", "start", "Rope"),
                FourPoles())),

        new("Sharpshooters (Pairs)", "Sharp Shooters (Version 2, with Net)", P,
            "One rider dismounts and throws tennis balls from behind the Changeover until one stays in the net, while their partner holds the pony.",
            "A Bending Pole is placed 3 m beyond the Changeover Line, with a vertically fixed Net on top, its opening about 30 cm across and deep enough to hold two Tennis Balls. A Bucket with twelve Tennis Balls is placed in front of the Changeover Line. Both riders are on foot behind the Start/Finish Line with one pony. Number One holds the pony on either side and Number Two stands on the opposite side, both facing forward. On the signal Number Two mounts the pony before crossing the Start/Finish Line. Number One then leads the pony across the Centre Line and waits there holding it. Number Two dismounts and runs to the Bucket, and from behind the Changeover Line throws Tennis Balls until one falls into the Net and stays there. Number Two then runs back to take hold of the pony and Number One mounts; this must be done before they cross the Centre Line again. Number Two then leads the pony back over the Start/Finish Line. If a Pair runs out of Tennis Balls, the rider concerned must run forward with the Bucket, collect any number and continue from behind the Changeover Line as before. The winning Pair is the one first over the Start/Finish Line, with Number One mounted and Number Two leading the pony, and two Tennis Balls in the Net. Ponies must be led by the nearer rein throughout. The hat band is worn by Number Two. When throwing, the rider's foot must not be touching the Changeover Line. The Line Steward will move forward level with the Changeover Line and call Fault, throw again if the rider's foot touches the line while throwing. A Tennis Ball that lands in the Net with the rider's foot on the line does not count and must be thrown again.",
            D.Make(4, true,
                D.Item("bucket", "top", on: D.Rep(12, D.Kid("ball"))),
                D.Item(null, "beyond", "Sharpshooters net"))),

        new("Small Sack (Pairs)", "Small Sack", P,
            "Dismount, climb into a sack and run or jump, leading your pony, to hand the sack to your partner.",
            "Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One rides forward and, before crossing the Centre Line, dismounts and gets into the Sack. Number One, leading their pony, then runs or jumps down the arena and hands the Sack to Number Two. Number Two rides forward and, before crossing the Centre Line, dismounts and gets into the Sack, then, leading their pony, runs or jumps down the arena and over the Start/Finish Line. Getting out of the Sack and handing it over must be done beyond the Changeover Line. Riders must not try to get into the Sack until they have dismounted, and the top of the Sack must not be rolled down. Every effort should be made to hold the Sack above knee level throughout. Riders must be on their feet when crossing the line, and ponies must be led by the nearer rein only. The winning Pair is the one whose Number Two is first across the Start/Finish Line, on their feet, in the Sack, leading their pony.",
            D.Make(4, true,
                D.Item("sack", "start"))),

        new("Stepping Stones (Pairs)", "Stepping Stones", P,
            "Dismount and lead your pony across six stepping stones on the Centre Line, one rider each way.",
            "Six Stepping Stones are placed 30 cm apart, straddling the Centre Line in a straight line up and down the arena, between the lines of Bending Poles. Number One is mounted at the Start/Finish End and Number Two at the Changeover End. On the signal Number One rides to the Stepping Stones, dismounts and, leading their pony, steps on each stone in turn and then on to the ground with the opposite foot from the one used on the final stone, before remounting and riding across the Changeover Line. Number Two does the same and, after remounting, rides across the Start/Finish Line. If a pony or rider knocks over a Stepping Stone, or a rider steps on the ground while crossing the stones, the rider must reset any fallen stones and, in both cases, go back and cross all the stones again from the direction they first attempted. When dismounted, riders must lead the pony by the nearer rein throughout. The winning Pair is the one whose Number Two is first across the Start/Finish Line.",
            D.Make(4, true,
                D.Item(null, "gap2", "Stepping stone", D.Rep(5, D.Kid(null, "Stepping stone"))))),

        new("STRUK Pole (Pairs)", "STRUK Pole", P,
            "Slot lettered cartons over a pole to spell S T R U K from the top, fetching them from behind the Changeover.",
            "A Bending Pole is set up level with Pole 1, with three blank Cartons already on it, in line with a circle 3 m behind the Changeover Line. In the circle, placed randomly, are four individually marked Cartons with the letters S, T, R and U. On the signal Number One, carrying a Carton marked K, rides to the Bending Pole and slots the Carton over it. Number One continues to the Changeover End, dismounts, collects the Carton marked U, rides down the arena and slots it over the pole. Number One then rides back up to the Changeover End, dismounts, collects the Carton marked R, rides down the arena, slots it over the pole and crosses the Start/Finish Line. Number Two rides to the Changeover End, dismounts, collects the Carton marked T, rides down the arena and slots it over the pole, then rides back up to the Changeover End, dismounts, collects the Carton marked S, rides down the arena, slots it over the pole and crosses the Start/Finish Line. The winning Pair is the one whose Number Two is first over the Start/Finish Line with all the Cartons on the pole, reading from top to bottom S, T, R, U, K, blank, blank, blank. Cartons placed in the wrong order or the wrong way up must be corrected by the rider concerned. The narrow neck of each Carton is the top.",
            D.Make(4, false,
                D.Item("box", "start", "Carton"),
                D.Pole("pole1", on: D.Rep(3, D.Kid("box", "Carton"))),
                D.Reps(4, D.Item("box", "beyond", "Carton")))),

        new("Sword (Pairs)", "Sword", P,
            "Collect four rings from the poles on a sword, two each, and hand the sword over at the Changeover.",
            "A line of four Bending Poles is erected about 7–9 m apart for each Pair. A plastic Sword Ring with a 100 mm hole is placed on each Pole and held with an elastic band. On Poles 1 and 2 the stem that holds the Ring is on the back edge of the Pole, and on Poles 3 and 4 it is on the front edge. Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One, holding a Sword, rides up the arena, collects two Rings from the tops of any Poles using the Sword, rides over the Changeover Line and passes the Sword, with the Rings still on it, to Number Two. Number Two rides down the arena, collects the other two Rings from the tops of the Poles using the Sword and rides over the Start/Finish Line. The winning Pair is the one whose Number Two crosses the Start/Finish Line first, holding the Sword with all four Rings on it. The Sword must always be held behind its crossbar, with no part of the hand or fingers in front of it, throughout the race. If a Ring is knocked off a Pole or dropped, the rider may dismount and pick it up by hand. They may hold any Rings already on the Sword with their fingers to help collect others, but must go back to where the error happened and carry on holding the Sword behind the crossbar. To help with remounting, the rider may lean the Sword against a Pole and pick it up once mounted, but must again go back to where the error happened. If the Sword or Rings are dropped during a handover, provided a genuine attempt to hand over was made, Number One may dismount, collect the Sword and Rings and, still dismounted, hand the Sword to Number Two, provided their hand is behind the crossbar. If the Sword or Rings are dropped over the Changeover Line and no genuine attempt to hand over was made, Number One may dismount and pick them up, but must remount and hand the Sword to Number Two mounted, with their hand behind the crossbar. If Number Two drops Rings into the field of play at the Changeover, they must correct the error and re-cross the Changeover Line before completing the race. There is no penalty if a Pole is knocked down.",
            D.Make(4, false,
                D.Item("sword", "start"),
                D.Pole("pole1", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole2", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole3", on: [D.Kid("quoit", "Sword ring")]),
                D.Pole("pole4", on: [D.Kid("quoit", "Sword ring")]))),

        new("Tack Shop (Pairs)", "Tack Shop", P,
            "Carry a coin to the penny dish, put two tack items in a grooming tray and hand the coin on.",
            "A Bending Pole topped with a Penny Dish is erected level with Pole 1. A plastic Grooming Tray is placed on a Table level with Pole 4. A second Table is placed 3 m behind the Changeover Line, holding four items: a Dandy Brush, a tin of Saddle Soap or Shoe Polish, a Tail Bandage and a Rubber Curry Comb. Looking from the Start/Finish Line they are placed front right Tail Bandage, back right Dandy Brush, back left Rubber Curry Comb and front left tin of Saddle Soap or Shoe Polish. Number One carries a Coin (10 cm diameter). On the signal Number One rides and places the Coin in the Penny Dish, then rides across the Changeover Line, collects any one item from the Table, places it in the Grooming Tray, rides back over the Changeover Line, collects a second item and places it in the Grooming Tray. Number One then rides to the Penny Dish, collects the Coin and hands it to Number Two behind the Start/Finish Line. Number Two completes the race in the same way. If a Table is knocked over or an item falls, the rider concerned may dismount to replace it. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the Coin, with all four items in the Grooming Tray on the Table level with Pole 4.",
            D.Make(4, false,
                D.Item("penny", "start"),
                D.Pole("pole1", on: [D.Kid("penny", "Penny dish")]),
                D.Table("pole4", [D.Kid("box", "Grooming tray")]),
                D.Table("beyond", [D.Kid(null, "Dandy brush"), D.Kid(null, "Saddle soap"), D.Kid(null, "Tail bandage"), D.Kid(null, "Curry comb")]))),

        new("Tennis Ball Shuffle (Pairs)", "Tennis Ball Shuffle", P,
            "Move a tennis ball between a socket on the Centre Line and cones level with Poles 1 and 4, one rider each way.",
            "A pole topped with a socket holding a Tennis Ball at the 9 o'clock position, as viewed from the Start/Finish Line, is placed on the Centre Line. Ball Cones are placed level with Poles 1 and 4. Number One is mounted at the Start/Finish End and Number Two at the Changeover End. On the signal Number One, carrying a Tennis Ball, rides to the cone level with Pole 1 and places the ball on it. Number One then rides to the socket, removes the Tennis Ball, rides to the cone level with Pole 4, places it there and crosses the Changeover Line. Number Two rides to the cone level with Pole 4, collects the Tennis Ball and places it in the socket at any position. Number Two then rides to the cone level with Pole 1, removes the Tennis Ball and carries it across the Start/Finish Line. The winning Pair is the one whose Number Two is first across the Start/Finish Line.",
            D.Make(4, true,
                D.Item("ball", "start"),
                D.Cone("ball", "pole1"),
                D.Pole("gap2", "Socket", [D.Kid("ball")]),
                D.Cone("ball", "pole4"))),

        new("Three-Legged Sack (Pairs)", "Three-Legged Sack", P,
            "Both riders dismount behind the Changeover, each put one leg in a sack and run back together leading their ponies.",
            "Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One, carrying a Sack, rides down the arena, over the Changeover Line, and dismounts. Number Two dismounts once Number One has crossed the Changeover Line. Numbers One and Two each put one leg into the Sack. Holding the Sack in one hand and leading their ponies with the other, they run back together over the Start/Finish Line. The winning Pair is the first over the Start/Finish Line. The Sack may be handed to Number Two before Number One has dismounted, provided the incoming pony's feet have fully crossed the Changeover Line. Ponies must be led by the nearer rein. The top of the Sack must not be rolled over at the start of the race.",
            D.Make(4, true,
                D.Item("sack", "start"))),

        new("Three Mug (Pairs)", "Three Mug", P,
            "Shuffle three mugs along four poles, one rider each way.",
            "Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 2, 3 and 4. Both riders are mounted at the Start/Finish End. On the signal Number One rides down the arena, moves the Mug from Pole 2 to Pole 1, then the Mug from Pole 3 to Pole 2, then the Mug from Pole 4 to Pole 3, and rides back over the Start/Finish Line. Number Two rides down the arena, moves the Mug from Pole 3 to Pole 4, then the Mug from Pole 2 to Pole 3, then the Mug from Pole 1 to Pole 2, and rides back over the Start/Finish Line. Mugs must be moved in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the Pole it came from before correcting the first error. The winning Pair is the one whose Number Two is first over the Start/Finish Line with Mugs on Poles 2, 3 and 4.",
            D.Make(4, false,
                D.Pole("pole1"),
                D.Pole("pole2", on: [D.Kid("mug")]),
                D.Pole("pole3", on: [D.Kid("mug")]),
                D.Pole("pole4", on: [D.Kid("mug")]))),

        new("Tubular Flag Race (Pairs)", "Tubular Flag Race", P,
            "Put four flags into matching tubes of a flag holder behind the Changeover, collecting from a cone on the Centre Line.",
            "A Four Flag Holder is placed 3 m behind the Changeover Line, and four White Flags are placed in a Flag Cone on the Centre Line. Both riders are mounted behind the Start/Finish Line. On the signal Number One, carrying the BLUE PG LOGO FLAG, rides to the Changeover End and places the Flag in the matching centre blue tube of the Four Flag Holder. This must be done from the mounted position. Number One then rides back and collects a Flag from the Flag Cone on the Centre Line, rides back up the arena and places it in one of the other tubes. Number One then collects another Flag from the Flag Cone on the Centre Line and hands it to Number Two behind the Start/Finish Line. Number Two completes the course in the same way, matching their White Flags to any of the remaining tubes in turn, so that at the end the Pair has placed four Flags in the Flag Holder correctly. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying the fifth Flag. If a rider knocks over the Four Flag Holder, the other Flags may be corrected from the ground, but the rider's own Flag must always be placed from the mounted position. At external shows and competitions, provided the first Flag is a different colour from the others, is placed in the centre tube and stays there, there is no need to use a blue Flag first or four White Flags after it. The Chief Steward should say which colours of Flag will be used before the competition starts.",
            D.Make(4, true,
                D.Item("flag", "start", "Blue flag"),
                D.Cone("flag", "gap2", D.Rep(4, D.Kid("flag"))),
                D.Item(null, "beyond", "4-Flag holder"))),

        new("Two Flag (Pairs)", "Two Flag", P,
            "Place a flag in one cone and swap it for the flag in the other, one rider each way.",
            "Each Pair has two Flag Cones, level with Poles 1 and 4, with a Flag in the Flag Cone level with Pole 4. Number One, carrying a Flag, is mounted behind the Start/Finish Line and Number Two is mounted behind the Changeover Line. On the signal Number One rides to the Flag Cone level with Pole 1 and places the Flag in it, then rides to the Flag Cone level with Pole 4, takes out the Flag and hands it to Number Two behind the Changeover Line. Number Two rides to the Flag Cone level with Pole 4 and places the Flag in it, then rides to the Flag Cone level with Pole 1, takes out the Flag and rides across the Start/Finish Line. Flag Cones knocked over must be set up immediately by the rider concerned. If a Flag comes off the Cane, the Cane alone may be used to complete the race. The winning Pair is the one whose Number Two is first over the Start/Finish Line carrying a Flag.",
            D.Make(4, false,
                D.Item("flag", "start"),
                D.Cone("flag", "pole1"),
                D.Cone("flag", "pole4", [D.Kid("flag")]))),

        new("Two Mug (Pairs)", "Two Mug", P,
            "Move two mugs along four poles, one rider each way.",
            "Four Bending Poles are placed in a line 7–9 m apart, with Mugs on Poles 1 and 3. Number One is mounted behind the Start/Finish Line and Number Two behind the Changeover Line. On the signal Number One rides down the arena, moves the Mug from Pole 1 to Pole 2, then the Mug from Pole 3 to Pole 4, and rides across the Changeover Line. Number Two rides down the arena, moves the Mug from Pole 4 to Pole 3, then the Mug from Pole 2 to Pole 1, and crosses the Start/Finish Line. The winning Pair is the one whose Number Two crosses the Start/Finish Line first with Mugs on Poles 1 and 3. Mugs must be placed on each Pole in the correct order. If one falls or is missed, the rider must replace the Mug before continuing; if the next Mug has already been moved, the rider must put that Mug back on the correct Pole before correcting the first error.",
            D.Make(4, false,
                D.Pole("pole1", on: [D.Kid("mug")]),
                D.Pole("pole2"),
                D.Pole("pole3", on: [D.Kid("mug")]),
                D.Pole("pole4"))),

        new("Tyre (Pairs)", "Tyre", P,
            "Each rider in turn dismounts, hands their pony to their partner and climbs through a tyre on the Centre Line.",
            "A motorcycle Tyre is placed on the Centre Line. Each Pair forms up behind the Start/Finish Line. On the signal Numbers One and Two ride to the Tyre, where Number One dismounts, hands their pony to Number Two, gets through the Tyre and remounts. Both riders then ride on across the Changeover Line, turn, and ride back towards the Tyre. Number Two dismounts, hands their pony to Number One, gets through the Tyre and remounts. The Pair then rides over the Start/Finish Line. The winning Pair is the first across the Start/Finish Line mounted on their ponies. The rider who is to lead the pony may take hold of the rein behind the line or as they ride down the arena. The pony must be led by the rein nearer the ridden pony and not by the bit ring or any other part of the bridle. The Tyre may not be touched until the pony has been correctly handed over. Riders are not allowed to run with the Tyre. The Tyre must stay between Poles 2 and 3 and in the Pair's lane throughout the race. If the Tyre rolls or is dragged outside Poles 2 and 3 in the Pair's lane, the dismounted rider must retrieve it before resuming the race.",
            D.Make(4, true,
                D.Item("quoit", "gap2", "Tyre"))),
    ];
}
