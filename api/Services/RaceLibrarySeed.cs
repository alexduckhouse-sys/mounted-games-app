namespace MountedGames.Api.Services;

/// <summary>
/// Canonical Pony Club Mounted Games race library — Team (4-rider) versions,
/// Junior Versions (JV), Pairs and sponsored Zone/Area 2026 aliases.
///
/// Diagram positions use the official lane landmarks:
/// Start = 0, P1 = 17, P2 = 39, Centre = 50, P3 = 61, P4 = 83, P5 = 91, Beyond = 96.
/// </summary>
internal static class RaceLibrarySeed
{
    public record Entry(string Name, string Category, string Summary, string Rules, string DiagramJson);

    // ── Bending & Mug family diagrams ─────────────────────────────────────────

    internal const string BendingDiagram =
        """[{"t":"lane","poles":5},{"t":"item","kind":"baton","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83},{"t":"pole","anchor":"pole5","x":91}]""";

    internal const string MugChangesDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"mug","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83,"on":[{"t":"item","kind":"mug"}]}]""";

    internal const string TwoMugDiagram =
        """[{"t":"lane","poles":4},{"t":"pole","anchor":"pole1","x":17,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole4","x":83}]""";

    internal const string ThreeMugDiagram =
        """[{"t":"lane","poles":4},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole3","x":61,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole4","x":83,"on":[{"t":"item","kind":"mug"}]}]""";

    internal const string FiveMugDiagram =
        """[{"t":"lane","poles":5},{"t":"item","kind":"mug","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83},{"t":"pole","anchor":"pole5","x":91},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"mug","label":"EGUK mug"},{"t":"item","kind":"mug"},{"t":"item","kind":"mug"},{"t":"item","kind":"mug"}]}]""";

    internal const string OneMugJuniorDiagram =
        """[{"t":"lane","poles":4},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39,"on":[{"t":"item","kind":"mug"}]},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83}]""";

    internal const string ThreeMugAndTablePairsDiagram =
        """[{"t":"lane","poles":5},{"t":"item","kind":"mug","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83},{"t":"pole","anchor":"pole5","x":91},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"mug"},{"t":"item","kind":"mug"}]}]""";

    // ── Ball / Cone / Socket / Bucket family diagrams ─────────────────────────

    internal const string BallAndConeDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17},{"t":"cone","kind":"ball","anchor":"pole4","x":83,"on":[{"t":"item","kind":"ball"}]}]""";

    internal const string BallAndFlagDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17},{"t":"cone","kind":"flag","anchor":"pole4","x":83,"on":[{"t":"item","kind":"flag"}]}]""";

    internal const string BallAndRacquetDiagram =
        """[{"t":"lane","poles":4},{"t":"item","label":"Racquet","anchor":"start","x":0,"on":[{"t":"item","kind":"ball"}]},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83}]""";

    internal const string BallAndRacquetOldDiagram =
        """[{"t":"lane","poles":3},{"t":"item","label":"Racquet","anchor":"start","x":0,"on":[{"t":"item","kind":"ball"}]},{"t":"pole","anchor":"pole1","x":25},{"t":"pole","anchor":"pole2","x":50},{"t":"pole","anchor":"pole3","x":75}]""";

    internal const string BallAndSocketDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole2","x":39,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole3","x":61,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole4","x":83,"on":[{"t":"item","kind":"ball"}]},{"t":"item","label":"Socket board","anchor":"beyond","x":96}]""";

    internal const string BallAndBucketDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"item","kind":"bucket","anchor":"gap2","x":50},{"t":"item","kind":"ball","anchor":"beyond","x":96},{"t":"item","kind":"ball","anchor":"beyond","x":96},{"t":"item","kind":"ball","anchor":"beyond","x":96},{"t":"item","kind":"ball","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string BouleAndBucketDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","label":"Boule","anchor":"start","x":0},{"t":"item","kind":"bucket","anchor":"gap2","x":50},{"t":"item","kind":"ball","label":"Boule","anchor":"beyond","x":96},{"t":"item","kind":"ball","label":"Boule","anchor":"beyond","x":96},{"t":"item","kind":"ball","label":"Boule","anchor":"beyond","x":96},{"t":"item","kind":"ball","label":"Boule","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string TennisBallShuffleDiagram =
        """[{"t":"lane","poles":5},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17},{"t":"pole","anchor":"pole3","x":50,"label":"Socket","on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole4","x":83},{"t":"midline"}]""";

    internal const string FourBallConeDiagram =
        """[{"t":"lane","poles":4},{"t":"cone","kind":"ball","anchor":"pole1","x":17},{"t":"cone","kind":"ball","anchor":"pole2","x":39},{"t":"cone","kind":"ball","anchor":"pole3","x":61},{"t":"cone","kind":"ball","anchor":"pole4","x":83},{"t":"item","kind":"penny","label":"Penny dish","anchor":"beyond","x":96,"on":[{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"}]}]""";

    // ── Flag family diagrams ──────────────────────────────────────────────────

    internal const string TwoFlagDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"flag","anchor":"start","x":0},{"t":"cone","kind":"flag","anchor":"pole1","x":17},{"t":"cone","kind":"flag","anchor":"pole4","x":83,"on":[{"t":"item","kind":"flag"}]}]""";

    internal const string FourFlagDiagram =
        """[{"t":"lane","poles":5},{"t":"cone","kind":"flag","anchor":"pole1","x":17},{"t":"cone","kind":"flag","anchor":"pole3","x":50,"on":[{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"}]},{"t":"cone","kind":"flag","anchor":"pole5","x":91},{"t":"midline"}]""";

    internal const string FiveFlagDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"flag","anchor":"start","x":0},{"t":"cone","kind":"flag","anchor":"gap2","x":50,"on":[{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"}]},{"t":"cone","kind":"flag","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string TubularFlagDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"flag","label":"Blue flag","anchor":"start","x":0},{"t":"cone","kind":"flag","anchor":"gap2","x":50,"on":[{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"},{"t":"item","kind":"flag"}]},{"t":"item","label":"4-Flag holder","anchor":"beyond","x":96},{"t":"midline"}]""";

    // ── Bottle family diagrams ────────────────────────────────────────────────

    internal const string BottleDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bottle","anchor":"start","x":0},{"t":"in","anchor":"gap2","x":50},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"bottle"}]},{"t":"midline"}]""";

    internal const string BottleCollectionDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"box","label":"Bottle carrier","anchor":"start","x":0},{"t":"in","anchor":"pole1","x":17},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"}]}]""";

    internal const string QuoitAndBottleDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bottle","anchor":"start","x":0},{"t":"in","anchor":"pole1","x":17},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"quoit","anchor":"beyond","x":96}]""";

    // ── Sack & Dismount family diagrams ───────────────────────────────────────

    internal const string BigSackDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sack","label":"Big sack","anchor":"gap2","x":50},{"t":"midline"}]""";

    internal const string SmallSackDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sack","anchor":"start","x":0},{"t":"midline"}]""";

    internal const string SteppingStonesDiagram =
        """[{"t":"lane","poles":4},{"t":"item","label":"Stepping stone","anchor":"gap2","x":50,"on":[{"t":"item","label":"Stepping stone"},{"t":"item","label":"Stepping stone"},{"t":"item","label":"Stepping stone"},{"t":"item","label":"Stepping stone"},{"t":"item","label":"Stepping stone"}]},{"t":"midline"}]""";

    internal const string HurdlesDiagram =
        """[{"t":"lane","poles":4},{"t":"item","label":"Hurdle","anchor":"gap2","x":50,"on":[{"t":"item","label":"Hurdle"},{"t":"item","label":"Hurdle"},{"t":"item","label":"Hurdle"},{"t":"item","kind":"mug"},{"t":"item","kind":"mug"}]},{"t":"midline"}]""";

    internal const string TyreDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"quoit","label":"Tyre","anchor":"gap2","x":50},{"t":"midline"}]""";

    internal const string GroomsDiagram =
        """[{"t":"lane","poles":4},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83}]""";

    // ── Equipment / Trays / Bins family diagrams ──────────────────────────────

    internal const string EquipmentJumbleDiagram =
        """[{"t":"lane","poles":4},{"t":"in","anchor":"pole1","x":17},{"t":"item","kind":"box","label":"Pyramid box","anchor":"beyond","x":96,"on":[{"t":"item","kind":"quoit"},{"t":"item","kind":"mug"},{"t":"item","kind":"ball"}]}]""";

    internal const string FarmersMarketDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"box","label":"Tack box tray","anchor":"start","x":0},{"t":"in","anchor":"pole1","x":17},{"t":"item","kind":"bottle","label":"Milk bottle","anchor":"beyond","x":96,"on":[{"t":"item","kind":"box","label":"Egg box"},{"t":"item","label":"Sausages"},{"t":"item","label":"Potato"}]}]""";

    internal const string TackShopDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"penny","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17,"on":[{"t":"item","kind":"penny","label":"Penny dish"}]},{"t":"in","anchor":"pole4","x":83,"on":[{"t":"item","kind":"box","label":"Grooming tray"}]},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","label":"Dandy brush"},{"t":"item","label":"Saddle soap"},{"t":"item","label":"Tail bandage"},{"t":"item","label":"Curry comb"}]}]""";

    internal const string BeanBagAndTableDiagram =
        """[{"t":"lane","poles":4},{"t":"in","anchor":"pole1","x":17},{"t":"item","kind":"sack","label":"Bean bag","anchor":"beyond","x":96},{"t":"item","kind":"sack","label":"Bean bag","anchor":"beyond","x":96},{"t":"item","kind":"sack","label":"Bean bag","anchor":"beyond","x":96},{"t":"item","kind":"ball","anchor":"beyond","x":96}]""";

    internal const string TwoBeanBagJuniorDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sack","label":"Bean bag","anchor":"start","x":0},{"t":"in","anchor":"gap2","x":50},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"sack","label":"Bean bag"}]},{"t":"midline"}]""";

    internal const string LitterDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"baton","label":"Litter cane","anchor":"start","x":0},{"t":"item","kind":"bin","anchor":"gap2","x":50},{"t":"item","kind":"mug","label":"Litter","anchor":"beyond","x":96},{"t":"item","kind":"mug","label":"Litter","anchor":"beyond","x":96},{"t":"item","kind":"mug","label":"Litter","anchor":"beyond","x":96},{"t":"item","kind":"mug","label":"Litter","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string OldSockDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sock","anchor":"start","x":0},{"t":"item","kind":"bucket","anchor":"gap2","x":50},{"t":"item","kind":"sock","anchor":"beyond","x":96},{"t":"item","kind":"sock","anchor":"beyond","x":96},{"t":"item","kind":"sock","anchor":"beyond","x":96},{"t":"item","kind":"sock","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string OldSockJvDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sock","anchor":"start","x":0},{"t":"item","kind":"bucket","anchor":"gap2","x":50},{"t":"item","kind":"penny","label":"Penny dish","anchor":"beyond","x":96,"on":[{"t":"item","kind":"sock"},{"t":"item","kind":"sock"},{"t":"item","kind":"sock"},{"t":"item","kind":"sock"}]},{"t":"midline"}]""";

    internal const string BalloonAndConeDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"baton","label":"Balloon cane","anchor":"start","x":0},{"t":"item","label":"Balloon board","anchor":"gap2","x":50,"on":[{"t":"item","kind":"ball","label":"Balloon"},{"t":"item","kind":"ball","label":"Balloon"},{"t":"item","kind":"ball","label":"Balloon"},{"t":"item","kind":"ball","label":"Balloon"},{"t":"item","kind":"ball","label":"Balloon"},{"t":"item","kind":"ball","label":"Balloon"}]},{"t":"midline"}]""";

    internal const string KnickerbockerGloryDiagram =
        """[{"t":"lane","poles":5},{"t":"cone","kind":"ball","label":"Ice cream cone","anchor":"start","x":0,"on":[{"t":"item","kind":"ball"}]},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83},{"t":"pole","anchor":"pole5","x":91}]""";

    internal const string RecyclingDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bin","label":"Wheelie bin","anchor":"pole1","x":17},{"t":"item","kind":"bottle","anchor":"beyond","x":96},{"t":"item","label":"Tin can","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Newspaper","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Letter","anchor":"beyond","x":96}]""";

    // ── Letter-pole family diagrams ───────────────────────────────────────────

    internal const string LetterPole8Diagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"box","label":"Carton","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"item","kind":"box","label":"Carton","anchor":"beyond","x":96,"on":[{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"}]}]""";

    internal const string LetterPole9Diagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"box","label":"Carton","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"item","kind":"box","label":"Carton","anchor":"beyond","x":96,"on":[{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"}]}]""";

    internal const string StrukPoleJvDiagram =
        """[{"t":"lane","poles":5},{"t":"pole","anchor":"pole3","x":50},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"bucket","on":[{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"},{"t":"item","kind":"box","label":"Carton"}]}]},{"t":"midline"}]""";

    // ── Spelling family diagrams ──────────────────────────────────────────────

    internal const string Spell8CardsDiagram =
        """[{"t":"lane","poles":4},{"t":"in","anchor":"gap2","x":50,"on":[{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"}]},{"t":"item","label":"Gibbet","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string Spell4CardsJuniorDiagram =
        """[{"t":"lane","poles":4},{"t":"in","anchor":"gap2","x":50,"on":[{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"},{"t":"item","kind":"card"}]},{"t":"item","label":"Hook post","anchor":"beyond","x":96},{"t":"midline"}]""";

    // ── Sharpshooters / Bowling / Hi-Lo / Specialty diagrams ──────────────────

    internal const string SharpshootersTargetDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bucket","anchor":"top","x":100,"on":[{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"}]},{"t":"item","kind":"quoit","label":"Target","anchor":"beyond","x":96},{"t":"item","kind":"quoit","label":"Target","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string SharpshootersNetDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bucket","anchor":"top","x":100,"on":[{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"},{"t":"item","kind":"ball"}]},{"t":"item","label":"Sharpshooters net","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string BowlingDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"bucket","anchor":"top","x":100,"on":[{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"},{"t":"item","kind":"ball","label":"Boule"}]},{"t":"item","kind":"bottle","anchor":"beyond","x":96},{"t":"item","kind":"bottle","anchor":"beyond","x":96},{"t":"item","kind":"bottle","anchor":"beyond","x":96},{"t":"item","kind":"bottle","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string HiLoDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"ball","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole2","x":39,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole3","x":61,"on":[{"t":"item","kind":"ball"}]},{"t":"cone","kind":"ball","anchor":"pole4","x":83,"on":[{"t":"item","kind":"ball"}]},{"t":"item","label":"Hi-Lo net","anchor":"beyond","x":96}]""";

    internal const string RopeDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"baton","label":"Rope","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83}]""";

    internal const string SwordDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sword","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17,"on":[{"t":"item","kind":"quoit","label":"Sword ring"}]},{"t":"pole","anchor":"pole2","x":39,"on":[{"t":"item","kind":"quoit","label":"Sword ring"}]},{"t":"pole","anchor":"pole3","x":61,"on":[{"t":"item","kind":"quoit","label":"Sword ring"}]},{"t":"pole","anchor":"pole4","x":83,"on":[{"t":"item","kind":"quoit","label":"Sword ring"}]}]""";

    internal const string PostmansDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"sack","label":"Post bag","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17},{"t":"pole","anchor":"pole2","x":39},{"t":"pole","anchor":"pole3","x":61},{"t":"pole","anchor":"pole4","x":83},{"t":"item","kind":"card","label":"Letter","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Letter","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Letter","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Letter","anchor":"beyond","x":96}]""";

    internal const string PostBoxDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"penny","anchor":"start","x":0},{"t":"pole","anchor":"pole1","x":17,"on":[{"t":"item","kind":"penny","label":"Penny dish"}]},{"t":"item","kind":"box","label":"Post box","anchor":"gap2","x":50},{"t":"item","kind":"card","label":"Newspaper","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Newspaper","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Newspaper","anchor":"beyond","x":96},{"t":"item","kind":"card","label":"Newspaper","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string PyramidDiagram =
        """[{"t":"lane","poles":4},{"t":"in","anchor":"gap2","x":50},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"box"},{"t":"item","kind":"box"},{"t":"item","kind":"box"},{"t":"item","kind":"box"}]},{"t":"midline"}]""";

    internal const string ShoppingSpreeDiagram =
        """[{"t":"lane","poles":5},{"t":"pole","anchor":"pole3","x":50,"on":[{"t":"item","kind":"penny","label":"Penny dish"},{"t":"item","kind":"penny"},{"t":"item","kind":"penny"},{"t":"item","kind":"penny"},{"t":"item","kind":"penny"}]},{"t":"in","anchor":"beyond","x":96,"on":[{"t":"item","kind":"bucket","on":[{"t":"item","kind":"sack","label":"Shopping bag"},{"t":"item","kind":"sack","label":"Shopping bag"},{"t":"item","kind":"sack","label":"Shopping bag"},{"t":"item","kind":"sack","label":"Shopping bag"},{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"},{"t":"item","kind":"bottle"}]}]},{"t":"midline"}]""";

    internal const string QuoitsAndConeDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"quoit","anchor":"start","x":0},{"t":"cone","kind":"ball","anchor":"pole1","x":17},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"quoit","anchor":"beyond","x":96},{"t":"item","kind":"ball","anchor":"beyond","x":96}]""";

    internal const string FishingDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"baton","label":"Fishing cane","anchor":"start","x":0},{"t":"item","kind":"bin","anchor":"gap2","x":50,"on":[{"t":"item","label":"Fish"},{"t":"item","label":"Fish"},{"t":"item","label":"Fish"},{"t":"item","label":"Fish"}]},{"t":"item","label":"Gibbet","anchor":"beyond","x":96},{"t":"midline"}]""";

    internal const string RosetteRowDiagram =
        """[{"t":"lane","poles":4},{"t":"item","kind":"baton","label":"Fishing cane","anchor":"start","x":0},{"t":"item","kind":"bin","anchor":"gap2","x":50,"on":[{"t":"item","kind":"quoit","label":"Rosette"},{"t":"item","kind":"quoit","label":"Rosette"},{"t":"item","kind":"quoit","label":"Rosette"},{"t":"item","kind":"quoit","label":"Rosette"}]},{"t":"item","label":"Gibbet","anchor":"beyond","x":96},{"t":"midline"}]""";

    public static readonly Entry[] All = new[]
    {
        // ── Bending family ─────────────────────────────────────────────────
        new Entry("Bending", "Bending",
            "Weave down and back through five bending poles, pass the baton, all four riders complete.",
            "Five Bending Poles 7–9 m apart, the first pole 14 m from the Start/Finish Line. On the signal each rider in turn rides down and back through the line, then hands the baton to the next rider behind the Start/Finish Line. Any pole knocked down must be replaced by the rider concerned, who resumes from where it fell. The winning team is the one whose Number Four crosses the Start/Finish Line first, mounted and carrying the baton.",
            BendingDiagram),

        new Entry("Mug Changes", "Mug",
            "Four poles, two mugs — move mugs back and forth between poles in sequence.",
            "Four Bending Poles 7–9 m apart, the first pole 14 m from the Start/Finish Line, mugs on Poles 2 and 4. Riders 1 & 3 start at Start/Finish; 2 & 4 at Changeover. Number One (carrying a mug) places on Pole 1, picks from Pole 2 and places on Pole 3, picks from Pole 4 and hands to Number Two. Pattern reverses going back. Mugs must be placed in correct order — any error must be corrected before continuing. Winner: Number Four first over the line, mounted, with mugs on Poles 2 and 4.",
            MugChangesDiagram),

        new Entry("Two Mug", "Mug",
            "Move two mugs along a row of poles, working as a team of four.",
            "Four Bending Poles 7–9 m apart, the first pole 14 m from the Start/Finish Line; mugs on Poles 1 and 3. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves Mug from 1→2 then 3→4, then crosses Changeover. Number Two moves Mug from 4→3 then 2→1, then crosses Start/Finish. Numbers 3 & 4 repeat. Mugs must move in the correct sequence — any error must be corrected. Winner: Number Four first over the line with mugs on Poles 1 and 3.",
            TwoMugDiagram),

        new Entry("Three Mug", "Mug",
            "Shuffle three mugs along a row of four poles.",
            "Four Bending Poles 7–9 m apart, mugs on Poles 2, 3 and 4, all riders at Start/Finish. Number One: Mug 2→1, 3→2, 4→3. Number Two: Mug 3→4, 2→3, 1→2. Numbers 3 and 4 repeat. Mugs must be moved in order; missed mugs must be replaced before continuing. Winner: Number Four first over the line with mugs on Poles 2, 3 and 4.",
            ThreeMugDiagram),

        new Entry("Five Mug – Pole Specific", "Mug",
            "Place mugs on bending poles in a specific order, including an EGUK logo mug on Pole 1.",
            "Five Bending Poles 7–9 m apart; table 3 m behind Changeover with four inverted mugs (one with EGUK logo at front-left). Each rider places a mug on the designated pole (2, 3, 4 in turn) and brings back another mug. Number Four places on Pole 5, collects the EGUK mug, and places it on Pole 1 on the way back. Mugs must be replaced inverted. Winner: Number Four first over the line with a mug on every pole and the EGUK mug on Pole 1.",
            FiveMugDiagram),

        new Entry("One Mug Race (Junior)", "Mug",
            "Junior version — one mug moves between Pole 2 and Pole 3.",
            "Four Bending Poles 7–9 m apart; mug on Pole 2. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves the mug from Pole 2 to Pole 3 then crosses Changeover. Number Two moves it back from Pole 3 to Pole 2 then crosses Start/Finish. Numbers 3 & 4 repeat. Winner: Number Four first over the line with the mug on Pole 2.",
            OneMugJuniorDiagram),

        new Entry("Three Mug and Table (Pairs)", "Mug",
            "Pairs version — shuttle three mugs between a table and the poles, inverted; riders ride straight and need not bend.",
            "Five Bending Poles 7–9 m apart, Pole 1 nearest the Start/Finish Line; a Table 3 m behind the Changeover Line. Both riders form up at the Start/Finish End. Each pair has three mugs: two inverted on the Table and one carried by Number One. Number One places the carried mug inverted on the Table, collects another mug from it and hands it to Number Two behind the Start/Finish Line. Number Two rides down, places the mug inverted on top of Pole 5, collects the final mug from the Table and returns to place it on Pole 1 before crossing the Start/Finish Line. Riders ride straight and need not bend through the poles. Any mug knocked off the Table must always be replaced inverted.",
            ThreeMugAndTablePairsDiagram),

        // ── Ball / Cone family ────────────────────────────────────────────
        new Entry("Ball and Cone", "Ball",
            "Move a tennis ball back and forth between two cones level with Poles 1 and 4.",
            "Two Ball Cones per team level with Poles 1 and 4; tennis ball starts on the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One (carrying a ball) places on Pole 1 cone, collects from Pole 4 cone, hands to Number Two. Number Two places on Pole 4, collects from Pole 1, hands to Number Three. Numbers 3 & 4 repeat. Winner: Number Four first over the line carrying the ball with another ball on the Pole 4 cone.",
            BallAndConeDiagram),

        new Entry("Ball and Flag", "Ball",
            "Combine ball-on-cone with flag-in-cone across two stations.",
            "Ball Cone level with Pole 1 and Flag Cone (with flag) level with Pole 4. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One places the ball on Pole 1 cone, collects the flag from Pole 4 cone and hands to Number Two. Number Two replaces the flag in the cone, collects the ball and hands to Number Three. Numbers 3 & 4 repeat. Winner: Number Four first over the line carrying the ball with the flag in the Flag Cone.",
            BallAndFlagDiagram),

        new Entry("Ball and Racquet", "Ball",
            "Balance a tennis ball on a racquet through four bending poles.",
            "Four Bending Poles 7–9 m apart; tennis racquet and ball per team. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries the ball on the racquet head, weaving through the poles, and hands over behind the line. Hand must always be behind the racquet's crosspiece. If the ball drops, the rider must retrieve and continue from where it fell.",
            BallAndRacquetDiagram),

        new Entry("Ball & Racquet (Old Version)", "Ball",
            "Balance a tennis ball on a racquet through three bending poles.",
            "Three Bending Poles 7–9 m apart per team; all riders form up behind the Start/Finish Line. Number One carries a racquet (with a cross piece through the centre of the handle) holding a tennis ball. The rider's hand must stay behind the cross piece and the ball must not be touched by hand, except when correcting an error. Number One rides up and back through the poles and hands the racquet and ball to Number Two behind the Start/Finish Line; Numbers Two, Three and Four repeat. If the ball is dropped the rider picks it up, mounted or dismounted, and resumes from where it fell. If it is dropped at the handover, the incoming rider may dismount and put it on the next rider's racquet, behind the Start/Finish Line. Any pole knocked down must be replaced by the rider concerned. Winner: Number Four first over the Start/Finish Line carrying the ball on the racquet.",
            BallAndRacquetOldDiagram),

        new Entry("Ball and Socket", "Ball",
            "Place a ball into a high socket board at the changeover, then return collecting from a cone.",
            "Four Ball Cones level with Poles 1–4, each holding a tennis ball; a Bending Pole topped with a 4-socket Socket Board 3 m beyond the Changeover. Each rider in turn carries a ball, places it into a socket, then collects a ball from any cone on the way back. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball.",
            BallAndSocketDiagram),

        new Entry("Ball and Socket – Cone Specific", "Ball",
            "As Ball and Socket but each rider must collect from a specific cone (4, 3, 2, then 1).",
            "Same setup as Ball and Socket. Each rider in turn places their ball into a socket and on the return must collect from the cone level with Pole 4, then 3, 2 and 1 in rider order. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball, with a ball in every socket.",
            BallAndSocketDiagram),

        new Entry("Ball and Bucket", "Ball",
            "Pick up tennis balls from the changeover end and drop them in a bucket on the midline.",
            "Four tennis balls per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a ball) drops it into the bucket, rides on to the Changeover, dismounts, picks up a ball, remounts and returns. Numbers 2, 3, 4 repeat. Number Four drops the last ball into the bucket on the way back. Winner: first Number Four over the line with 5 balls in the bucket.",
            BallAndBucketDiagram),

        new Entry("Boule and Bucket", "Ball",
            "Same as Ball and Bucket but with plastic boules instead of tennis balls.",
            "Four plastic boules per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Each rider in turn drops a boule in the bucket on the way up, dismounts at the Changeover to collect another and brings it back. Number Four drops the last on the way back. Winner: first Number Four over the line with 5 boules in the bucket.",
            BouleAndBucketDiagram),

        new Entry("Tennis Ball Shuffle", "Ball",
            "Move a tennis ball between a socket on the centre line and two cones level with Poles 1 and 4.",
            "Pole on the Centre Line topped with a socket (ball starts at the 9 o'clock position); cones level with Poles 1 and 4. Number One: ball→Cone 1, then socket→Cone 4. Number Two: Cone 4→socket, then Cone 1→hands to Number Three. Numbers 3 & 4 repeat. Number Four carries the final ball over the line.",
            TennisBallShuffleDiagram),

        new Entry("Four Ball Cone (Tennis Ball Shuffle)", "Ball",
            "Collect a tennis ball from a penny dish at the Changeover and place on cones one by one.",
            "Four Ball Cones level with Poles 1–4; a pole topped with a Penny Dish containing four tennis balls 3 m beyond the Changeover. Each rider in turn collects a ball from the Penny Dish and places it on any cone on the way back. Winner: Number Four first over the line with a ball on every cone.",
            FourBallConeDiagram),

        new Entry("Four Ball Cone (2002)", "Ball",
            "Collect a tennis ball from a penny dish at the Changeover and place it on any ball cone, one rider at a time.",
            "Four Ball Cones in a line down the arena, level with Poles 1–4; a Bending Pole topped with a Penny Dish holding four tennis balls 3 m behind the Changeover Line, in line with the cones. All four riders start from the Start/Finish End. Number One rides across the Changeover Line, collects a ball from the Penny Dish, rides back and places it on any ball cone before crossing the Start/Finish Line. Numbers Two, Three and Four repeat. Winner: Number Four first over the Start/Finish Line with a tennis ball on each of the four ball cones.",
            FourBallConeDiagram),

        // ── Flag family ───────────────────────────────────────────────────
        new Entry("Two Flag", "Flag",
            "Move a single flag between two flag cones level with Poles 1 and 4.",
            "Two Flag Cones per team level with Poles 1 and 4; flag starts in the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries a flag, places it in one cone and collects from the other. Knocked cones must be reset immediately by the rider. Winner: Number Four first over the line carrying a flag.",
            TwoFlagDiagram),

        new Entry("Four Flag", "Flag",
            "Distribute four flags from a centre cone into two outer cones.",
            "Three Flag Cones per team — level with Pole 1, on the Centre Line and level with Pole 5. Four flags start in the centre cone. Each rider in turn collects a flag from the centre cone and places it into one of the other cones, then crosses the Start/Finish Line. Winner: Number Four first over the line with two flags in each outer cone and the centre cone empty.",
            FourFlagDiagram),

        new Entry("Five Flag", "Flag",
            "Place flags one by one into the Changeover-end cone.",
            "A Flag Cone 3 m behind the Changeover Line and another on the Centre Line; five flags — four start in the Centre-Line cone, one carried by Number One. Each rider in turn places their flag into the Flag Cone 3 m behind the Changeover Line and collects a flag from the Centre-Line cone on the way back. Winner: Number Four first over the Start/Finish Line carrying a flag, with four flags in the cone behind the Changeover Line.",
            FiveFlagDiagram),

        new Entry("Tubular Flag Race", "Flag",
            "Place flags into matching tubes on a 4-Flag Holder behind the Changeover.",
            "4-Flag Holder (central blue tube, three white tubes around it) 3 m behind the Changeover; four white flags in a Flag Cone on the Centre Line. Number One places the BLUE PG LOGO flag into the centre blue tube (mounted); each subsequent rider matches a white flag to any white tube. Number Four collects the final flag from the centre cone on the way back. Winner: Number Four first over the line carrying the flag.",
            TubularFlagDiagram),

        // ── Bottle family ─────────────────────────────────────────────────
        new Entry("Bottle", "Bottle",
            "Shuffle a 500 g bottle between a table on the centre line and another at the Changeover.",
            "Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. A 750 ml bottle weighing 500 g sits on the Changeover table; another similar bottle is carried by Number One. Each rider in turn places one bottle on the centre table, collects the other from the Changeover table and hands it on. Knocked bottles/tables must be replaced upright. Winner: Number Four first over the line, mounted, carrying the bottle.",
            BottleDiagram),

        new Entry("Bottle Collection", "Bottle",
            "Build up a 4-bottle carrier from bottles at the Changeover end.",
            "Table level with Pole 1 and another 3 m beyond the Changeover; four weighted plastic bottles on the Changeover table. Number One (carrying a plastic Bottle Carrier) places it on the Pole 1 table, rides on to collect a bottle and places it in the Carrier. Numbers 2, 3 and 4 each add a bottle. Number Four picks up the full Carrier and carries it across the line. Knocked bottles must be replaced upright.",
            BottleCollectionDiagram),

        new Entry("Quoit and Bottle", "Bottle",
            "Place a bottle on a table and ring it with four quoits.",
            "Table level with Pole 1; four rubber quoits in a circle 3 m beyond the Changeover. Number One (carrying a bottle, senior 500 g) places it upright on the table, rides on to collect a quoit dismounted and rings the bottle on the way back. Numbers 2, 3 and 4 each add a quoit. Bottle must remain upright; quoits must be fully over the bottle. Winner: Number Four first over the line with the bottle ringed by four quoits.",
            QuoitAndBottleDiagram),

        // ── Sack family ───────────────────────────────────────────────────
        new Entry("Big Sack", "Sack",
            "All four riders run together in one big sack down the arena.",
            "Big Sack 1 m beyond the Centre Line; Number Five at the Changeover holding the ponies. Numbers 1 & 3 lead Numbers 2 & 4 mounted to the Changeover where 2 & 4 dismount and hand ponies to Number Five. All four then run back, step into the Big Sack and travel in it across the Start/Finish Line. Winner: first team whose sack with all four members crosses the line.",
            BigSackDiagram),

        new Entry("Small Sack", "Sack",
            "Each rider in turn dismounts and jumps in a sack down the arena.",
            "Numbers 1 (carrying a sack) & 3 mounted at Start/Finish; 2 & 4 at Changeover. Each rider rides forward, dismounts before the Centre Line, gets into the sack and runs/jumps leading their pony to the next changeover line, where they hand the sack over. Sack must be held above knee level; ponies led by the near rein. Winner: Number Four first over the line on their feet in the sack.",
            SmallSackDiagram),

        new Entry("Three-Legged Sack", "Sack",
            "Pairs of riders run together in one sack — one leg each.",
            "Numbers 1 & 3 mounted at Start/Finish; 2 & 4 at Changeover. Number One rides up carrying a sack, dismounts beyond the Changeover; Number Two dismounts too. Each puts one leg into the sack, holds it in one hand and their pony in the other, and they run back together across the Start/Finish Line. Number Three then carries the sack up to Number Four to repeat. Winner: Numbers 3 & 4 first over the line.",
            SmallSackDiagram),

        // ── Dismount family ───────────────────────────────────────────────
        new Entry("Stepping Stones", "Dismount",
            "Dismount, lead pony and walk across six stones straddling the centre line, then remount.",
            "Six Stepping Stones 30 cm apart in a line up and down the arena across the Centre Line. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider rides to the stones, dismounts and leads their pony, stepping on each stone and the ground with the opposite foot from the final stone, then remounts and continues. Knocked stones / stepping off must be corrected from the original direction. Winner: Number Four first over the line.",
            SteppingStonesDiagram),

        new Entry("Hurdles", "Dismount",
            "Negotiate four alternating-height hurdles by stepping over and crawling under.",
            "Four hurdles 1.85 m apart straddling the Centre Line, alternately low and high; mug on each of the higher hurdles. Pairs of riders ride up together: one dismounts and hands their pony to the other, then steps over/crawls under in the pattern, remounts and both ride on. Each pair takes a turn. Knocked hurdles or fallen mugs must be replaced and the rider re-negotiates all hurdles. Winner: final pair first across the Start/Finish Line, mounted.",
            HurdlesDiagram),

        new Entry("Tyre", "Dismount",
            "Pass a motorcycle tyre over a rider standing on the centre line, in pairs.",
            "Motorcycle tyre on the Centre Line. Numbers 1 & 2 at Start/Finish, 3 at Changeover, 4 behind the 6-m line. Pairs ride up; one dismounts, hands pony to the other, steps through the tyre, remounts and the pair continues. Each pair takes a turn. Tyre must stay between Poles 2 and 3 in the lane; ponies led by the near rein. Winner: the final pair (1 & 4) first across the line mounted.",
            TyreDiagram),

        new Entry("Grooms", "Dismount",
            "Lead a riderless pony through four bending poles, handing it on at each changeover.",
            "Four Bending Poles 7–9 m apart. Number One holds Number Two's pony at Start/Finish; 3 holds 4's behind the 6-m line; 2 holds 3's at Changeover; 4 stands behind 2 at Changeover. Riders take turns weaving through the poles leading the next rider's pony, handing off at the changeover so the next rider mounts and continues. Ponies led by the rein nearer the ridden pony. Letting go means returning to the fault point.",
            GroomsDiagram),

        // ── Equipment / Trays ─────────────────────────────────────────────
        new Entry("Equipment Jumble", "Equipment",
            "Build a stack of pyramid box, quoit, mug and tennis ball on a table at Pole 1.",
            "Four items in a circle 3 m behind the Changeover — Pyramid Box, Quoit, Mug and Tennis Ball. Table level with Pole 1. Number One collects the Pyramid Box and places it on the table. Number Two adds the Quoit on top. Number Three adds the Mug (open end up, inside the Quoit). Number Four adds the Tennis Ball inside the Mug. All four items must remain stacked. Winner: Number Four first over the line with the stack intact.",
            EquipmentJumbleDiagram),

        new Entry("Farmers' Market", "Equipment",
            "Fill a tack-box tray with sausages, potato, egg box and milk from the changeover.",
            "Table level with Pole 1; four items (sausages, potato, egg box, milk bottle — upright) in a circle 3 m behind the Changeover. Number One places a Tack Box Tray on the table then collects the bottle and adds it. Number Two adds the potato, Number Three the sausages, Number Four the egg box and then picks up the full tray to carry across the line. Bottle must be upright while in the circle and in the tray until Number Four collects it.",
            FarmersMarketDiagram),

        new Entry("Tack Shop", "Equipment",
            "Five-rider race — Number Five hands tack items into a grooming tray on a table.",
            "Bending Pole topped with Penny Dish level with Pole 1; Grooming Tray on a table level with Pole 4; Number Five at the Changeover with a table holding dandy brush, saddle soap, tail bandage and curry comb. Each of riders 1–4 carries a coin to the Penny Dish, collects the Grooming Tray, rides to Number Five who places an item in it, then returns the tray to the Pole 4 table, retrieves the coin and hands to the next rider. Winner: Number Four first over the line carrying the coin with all four items in the tray.",
            TackShopDiagram),

        new Entry("Bean Bag and Table", "Equipment",
            "Stack three bean bags and a tennis ball on a table level with Pole 1.",
            "Table level with Pole 1; three bean bags and a tennis ball placed randomly in a circle 3 m behind the Changeover. All four riders at Start/Finish. Numbers 1, 2 and 3 each ride up, dismount, collect a bean bag and place it on the table. Number Four collects the tennis ball and places it on the table. Bean bags and ball may touch. Winner: Number Four first over the line with all items on the table.",
            BeanBagAndTableDiagram),

        new Entry("Two Bean Bag Race (Junior)", "Equipment",
            "Junior version — swap two bean bags between a centre-line table and a table behind the Changeover.",
            "Two Tables per team: one on the Centre Line and one 3 m beyond the Changeover Line, with a bean bag on the Changeover table. All four riders line up mounted at the Start/Finish End. Number One, carrying a bean bag, places it on the Centre Line table, rides on to collect the bean bag from the Changeover table and returns to hand it to Number Two behind the Start/Finish Line. Number Two places the bean bag on the Changeover table, collects the one on the Centre Line table on the way back and hands it on. Number Three repeats Number One and Number Four repeats Number Two. Winner: Number Four first over the Start/Finish Line carrying a bean bag, with the other on the Changeover table.",
            TwoBeanBagJuniorDiagram),

        new Entry("Litter", "Equipment",
            "Spear pieces of litter with a cane and drop them in a bin on the centre line.",
            "Four pieces of litter side-by-side in a circle 3 m beyond the Changeover (open ends towards the Start/Finish); litter bin on the Centre Line. Each rider in turn rides up with a cane, spears a piece of litter at the Changeover and drops it into the bin on the way back. Litter must not be touched by hand except to clear jams. Winner: Number Four first over the line carrying the cane with all four pieces in the bin.",
            LitterDiagram),

        new Entry("Old Sock", "Equipment",
            "Drop five sock-balls into a bucket on the centre line.",
            "Four sock-balls in a circle 3 m beyond the Changeover Line; a bucket on the Centre Line. Number One (carrying a fifth sock) drops it into the bucket, rides on, dismounts beyond the Changeover, picks up another sock from the circle, remounts and returns to hand it on. Numbers 2, 3 and 4 repeat. Number Four drops the last sock into the bucket on the way back. Winner: first Number Four over the Start/Finish Line with five socks in the bucket.",
            OldSockDiagram),

        new Entry("Balloon and Cone", "Equipment",
            "Burst six balloons on a board along the centre line using a pin-tipped cane.",
            "Six balloons attached 46 cm apart to a board straddling the Centre Line; pin-tipped 1.22 m cane. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn rides through bursting at least one balloon and hands the cane on. Each rider must burst at least one balloon or the team is eliminated. Winner: Number Four first over the line carrying the cane with at least four balloons burst.",
            BalloonAndConeDiagram),

        new Entry("Knickerbocker Glory Race", "Equipment",
            "Carry a plastic ball in an ice-cream cone weaving through five bending poles.",
            "Five Bending Poles 7–9 m apart per team; an Ice Cream Cone and a ~15 cm ball per team. Each rider in turn rides down and back bending through the poles holding the cone, ball balanced in it. Ball not to be touched by hand except when remounting. Drops must be retrieved and replaced before continuing. Winner: Number Four first over the line carrying the cone with the ball on it.",
            KnickerbockerGloryDiagram),

        new Entry("Recycling Race", "Equipment",
            "Sort four recycling items into the correct slot of a wheelie bin level with Pole 1.",
            "120-litre wheelie bin with a 2-slot insert (circular, rectangular) level with Pole 1; bottle, tin can, newspaper and letter in a circle 3 m behind the Changeover. Number One opens the bin's lid then completes a rider's leg; Numbers 2 and 3 each complete one. Number Four completes the last leg and closes the lid before crossing the line. Bottles/cans through the circle, newspapers/letters through the slot. Insert in correct position throughout or the team is eliminated.",
            RecyclingDiagram),

        // ── Letter-pole family ────────────────────────────────────────────
        new Entry("PGSPORTS Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole in the correct order to spell PGSPORTS.",
            "Bending pole level with Pole 1; seven lettered cartons (P G S P O R T) in a circle 3 m beyond the Changeover; the 8th carton (S) carried by Number One. Riders take turns slotting their carton over the pole and collecting the next one dismounted. Final order top to bottom: PGSPORTS. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole8Diagram),

        new Entry("Pony Club Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole to spell PONY CLUB top-to-bottom.",
            "As PGSPORTS Pole but cartons spell PONY CLUB (P, O, N, Y, C, L, U, B). Bending pole level with Pole 1; cartons placed randomly in a circle 3 m beyond the Changeover. Wrong order or upside-down must be corrected.",
            LetterPole8Diagram),

        new Entry("Spillers Pole", "Letter Pole",
            "Slot eight lettered cartons onto a pole to spell SPILLERS.",
            "As PGSPORTS Pole but the cartons spell SPILLERS (S, P, I, L, L, E, R, S). Bending pole level with Pole 1; cartons placed randomly in the Changeover circle. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole8Diagram),

        new Entry("Robinsons Pole", "Letter Pole",
            "Slot nine lettered cartons onto a pole to spell ROBINSONS.",
            "As PGSPORTS Pole but the cartons spell ROBINSONS (R, O, B, I, N, S, O, N, S). Eight cartons in the Changeover circle and one carried by Number One. Wrong order or upside-down must be corrected by the rider concerned.",
            LetterPole9Diagram),

        new Entry("STRUK Pole", "Letter Pole",
            "Slot lettered and blank cartons to spell STRUK with three blanks beneath.",
            "Bending pole level with Pole 1; seven cartons in a circle 3 m beyond the Changeover with letters S, T, R, U, K and two blanks. Riders take turns slotting their carton (and bringing back the next). Final order top-to-bottom: S, T, R, U, K, blank, blank, blank (Number One starts with a blank).",
            LetterPole8Diagram),

        // ── Spelling family ───────────────────────────────────────────────
        new Entry("Spell E G U K", "Spelling",
            "Pick up letter cards from the centre line and hang them in spelling order on a gibbet.",
            "Table on the Centre Line with eight cards (four letters E, G, U, K and four with the EGUK logo). Gibbet 3 m beyond the Changeover with two crossbars of four hooks each. Each of the four riders collects two cards in turn and hangs them on the correct hooks so the top row spells EGUK and the bottom row shows logos. Dropped cards may be retrieved dismounted but must be hung mounted.",
            Spell8CardsDiagram),

        new Entry("Spell EQUI TREK", "Spelling",
            "As Spell EGUK but the cards spell EQUI on top and TREK on the bottom.",
            "Table on the Centre Line with eight cards spelling EQUI TREK; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so EQUI sits across the top row and TREK across the bottom row. Dropped cards may be retrieved dismounted but must be hung from the mounted position.",
            Spell8CardsDiagram),

        new Entry("Spell PONY CLUB", "Spelling",
            "As Spell EGUK but the cards spell PONY on top and CLUB on the bottom.",
            "Table on the Centre Line with eight cards spelling PONY CLUB; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so PONY sits across the top row and CLUB across the bottom row.",
            Spell8CardsDiagram),

        new Entry("Spell PONY PREP", "Spelling",
            "As Spell EGUK but the cards spell PONY on top and PREP on the bottom.",
            "Table on the Centre Line with eight cards spelling PONY PREP; gibbet at the Changeover with two crossbars of four hooks. Each rider collects two cards in turn and hangs them so PONY sits across the top row and PREP across the bottom row.",
            Spell8CardsDiagram),

        new Entry("Spell PONY (Juniors)", "Spelling",
            "Junior version — pick up four letter cards from the centre line and hang them on a post to spell PONY.",
            "A Table on the Centre Line with four 20 cm square cards spelling PONY, placed side by side and separately spaced. Number Five stands 3 m behind the Changeover Line holding a post about 1.22 m (4 ft) high with a cross bar of four hooks facing Number Five. All four riders line up at the Start/Finish End. Number One picks up any one card, hands it to Number Five over the Changeover Line and waits behind the line until Number Five has hung it so that, viewed from the Start/Finish Line, the cards read PONY; Number One then returns across the Start/Finish Line. Numbers Two, Three and Four repeat. Number Five must stay behind the Changeover Line. A dropped card may be retrieved mounted or dismounted but must be handed to Number Five from the mounted position. Cards knocked off the Table can be replaced in any order. Winner: Number Four first over the Start/Finish Line with all four cards on the hooks spelling PONY.",
            Spell4CardsJuniorDiagram),

        // ── Sharpshooters / Bowling ───────────────────────────────────────
        new Entry("Sharpshooters (Version 1, with Target)", "Other",
            "Knock down two targets behind the Changeover by throwing tennis balls.",
            "Two Bending Poles 1 m apart, 3 m beyond the Changeover, each with a sleeved circular target on top. Bucket of 12 tennis balls in front of the Changeover. Two ponies for four riders. Pairs lead/ride to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover throws balls to knock down one target each. Foot on the line = 'fault, throw again'. Winner: Numbers 3 & 4 first over the line (Number 4 mounted) with both targets down.",
            SharpshootersTargetDiagram),

        new Entry("Sharp Shooters (Version 2, with Net)", "Other",
            "Throw tennis balls into a vertically-fixed net behind the Changeover.",
            "Bending pole 3 m beyond the Changeover topped with a vertical net (~30 cm wide). Bucket of 12 tennis balls in front of the Changeover. Two ponies for four riders. Pair rides to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover throws balls until one lands in and stays in the net. Foot on the line = throw again. Winner: Numbers 3 & 4 first over the line with two balls in the net.",
            SharpshootersNetDiagram),

        new Entry("Bowling", "Other",
            "Knock down four bottles behind the Changeover using thrown boules.",
            "Four 500 g bottles 30 cm apart 3 m beyond the Changeover; bucket of 12 boules in front of the Changeover. Two ponies for four riders. Pairs lead/ride to the Centre Line; the dismounted rider runs to the bucket and from behind the Changeover bowls one boule to knock a single bottle (extras must be reset). Pair returns, swaps and the next pair repeats. Winner: Numbers 3 & 4 first over the line (Number 4 mounted) with all four bottles down.",
            BowlingDiagram),

        // ── Hi Lo / Rope ──────────────────────────────────────────────────
        new Entry("HI LO – Cone Specific", "Ball",
            "Place balls into a high net behind the Changeover, collecting from cones in reverse order.",
            "Four Ball Cones level with Poles 1–4 with a tennis ball on each; 2.13 m pole topped with a net 3 m beyond the Changeover. Number One (carrying a ball) places it in the net, collects from Cone 4 on the way back. Number Two collects from Cone 3, Number Three from Cone 2, Number Four from Cone 1. Missed balls may be retrieved dismounted but must be put in the net mounted.",
            HiLoDiagram),

        new Entry("Rope", "Other",
            "Pairs of riders carry a rope between them through four bending poles.",
            "Four Bending Poles 7–9 m apart per team; ~90 cm rope (no loops or knots). Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One weaves up carrying the rope; at the Changeover, Number Two grasps the rope and they weave back together. After crossing Start/Finish, Number Three takes the rope; Numbers 2 & 3 weave up together; Number Four joins for the final leg back. Holding of hands is not permitted. Winner: Numbers 3 & 4 first over the line, mounted, carrying the rope.",
            RopeDiagram),

        // ── Specialty ─────────────────────────────────────────────────────
        new Entry("Sword", "Other",
            "Lance sword rings off the tops of bending poles.",
            "Four Bending Poles 7–9 m apart per team; plastic sword ring (100 mm hole) on each pole, secured with an elastic band. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries the sword down the arena, collecting one ring off the top of any pole, and hands the sword on at the next changeover line. Hand must be behind the sword's crosspiece throughout. Knocked rings may be picked up dismounted; place against a pole to remount if needed. Winner: Number Four first over the line carrying the sword with all four rings on it.",
            SwordDiagram),

        new Entry("Postman's", "Other",
            "Deliver a letter into a post bag through four bending poles.",
            "Four Bending Poles 7–9 m apart per team; Number Five dismounted 3 m beyond the Changeover holding four letters. Each rider in turn carries the Post Bag through the poles to Number Five who hands them a letter; rider puts it in the bag and rides back through the poles to hand the bag on. Letter must be in the bag and hand out of the bag before re-crossing the Changeover. Winner: Number Four first over the line carrying the bag with four letters.",
            PostmansDiagram),

        new Entry("Post Box", "Other",
            "Five-rider race — post newspapers through a post box on the centre line.",
            "Bending Pole topped with a Penny Dish level with Pole 1; post box (122 cm tall, 25 cm slot) on the Centre Line; Number Five with four A4 newspapers in a circle 3 m behind the Changeover. Each of riders 1–4 carries a coin to the Penny Dish, collects a newspaper from Number Five, rides back and posts it through the post box (pushing from the changeover side), then collects the coin and hands it on. Newspaper must not be folded. Winner: Number Four first over the line carrying the coin.",
            PostBoxDiagram),

        new Entry("Pyramid – PGUK Version", "Equipment",
            "Stack four lettered boxes on the centre table to spell P G U K top-to-bottom.",
            "Table on the Centre Line and another 3 m beyond the Changeover. The Changeover table holds four unstacked 500 g plastic boxes lettered K, U, G, P (front-right, back-right, back-left, front-left as viewed from Start/Finish). Number One collects K and places it on the centre table; Number Two adds U; Number Three adds G; Number Four adds P. Stack must spell P G U K top-to-bottom. Boxes can be adjusted before/after placing.",
            PyramidDiagram),

        new Entry("PG Sports Shopping Spree Race", "Other",
            "Trade pennies for shopping bags and hang them on hooks under the Penny Dish.",
            "Bending pole on the Centre Line topped with a Penny Dish that has four hooks underneath; four pennies stacked in the dish. Table 3 m beyond the Changeover holding a bucket with four branded shopping bags (each containing a Junior bottle). Each rider in turn carries a penny to Number Five at the Changeover, swaps it for a shopping bag and hangs both handles on a free hook under the Penny Dish. Winner: Number Four first over the line with four pennies in the bucket and four bags hanging correctly.",
            ShoppingSpreeDiagram),

        new Entry("Quoits and Cone", "Equipment",
            "Ring four quoits and a tennis ball onto a cone level with Pole 1.",
            "Ball Cone level with Pole 1; three quoits and a tennis ball in a circle 3 m beyond the Changeover. Number One (carrying a quoit) places it over the cone, then collects another quoit dismounted at the Changeover and hands it on. Numbers 2 and 3 add a quoit each. Number Four collects the tennis ball and places it on top of the cone on the way back. Quoits must be fully over the cone; tennis ball correctly placed.",
            QuoitsAndConeDiagram),

        new Entry("Fishing Race", "Other",
            "Hook plastic fish from a bin and hand them to Number Five for hanging on a gibbet.",
            "Bin with four fish on the Centre Line; Number Five 3 m beyond the Changeover holding a gibbet (hooks facing down the arena). Each rider in turn rides up carrying a hooked cane, hooks a fish from the bin and rides on; Number Five unhooks it and secures it on the gibbet. Rider waits behind the Changeover until placement is complete, then rides back to hand the cane on. Cane has a 10 cm rubber stopper near the hook for safety. Winner: Number Four first over the line with all four fish on the gibbet.",
            FishingDiagram),

        new Entry("Rosette Row", "Other",
            "Five-rider race — hook rosettes from a bin and hand them to Number Five to spell PGUK.",
            "Bin on the Centre Line containing four coloured rosettes (Blue P at 12, Red G at 3, Green U at 6, Yellow K at 9); Number Five 3 m beyond the Changeover holding a gibbet. Each rider hooks any rosette, rides on and waits behind the Changeover while Number Five places it on the correct hook so the gibbet spells P G U K left-to-right from the Start/Finish view. Dropped rosettes may be retrieved.",
            RosetteRowDiagram),

        // ── Zone 2026 sponsored aliases ───────────────────────────────────
        new Entry("Hollywood Bowl Boule & Bucket", "Zone 2026 · Ball",
            "Zone 2026 sponsored name for Boule and Bucket.",
            "Four plastic boules per team in a circle 3 m behind the Changeover; bucket on the Centre Line. Each rider in turn drops a boule in the bucket on the way up, dismounts at the Changeover to collect another and brings it back. Number Four drops the last on the way back. Winner: first Number Four over the line with 5 boules in the bucket.",
            BouleAndBucketDiagram),

        new Entry("Hollywood Bowl Old Sock", "Zone 2026 · Equipment",
            "Zone 2026 sponsored name for Old Sock.",
            "Four sock-balls in a circle 3 m behind the Changeover; bucket on the Centre Line. Number One (carrying a sock) drops it in the bucket, rides on, dismounts, picks up another sock and brings it back. Numbers 2, 3 and 4 repeat. Number Four drops the last sock on the way back. Winner: first Number Four over the line with 5 socks in the bucket.",
            OldSockDiagram),

        new Entry("Tally Ho Farm Ball & Socket", "Zone 2026 · Ball",
            "Zone 2026 sponsored name for Ball and Socket.",
            "Four Ball Cones level with Poles 1–4, each holding a tennis ball; a Bending Pole topped with a 4-socket Socket Board 3 m beyond the Changeover. Each rider in turn carries a ball, places it into a socket, then collects a ball from any cone on the way back. Drops can be replaced dismounted. Winner: Number Four first over the line carrying the last ball.",
            BallAndSocketDiagram),

        new Entry("PGSports UK Shopping Spree", "Zone 2026 · Other",
            "Zone 2026 sponsored name for the Shopping Spree race.",
            "Bending pole on the Centre Line topped with a Penny Dish that has four hooks underneath; four pennies stacked in the dish. Table 3 m beyond the Changeover holding a bucket with four branded shopping bags (each containing a Junior bottle). Each rider in turn carries a penny to Number Five at the Changeover, swaps it for a shopping bag and hangs both handles on a free hook under the Penny Dish. Winner: Number Four first over the line with four pennies in the bucket and four bags hanging correctly.",
            ShoppingSpreeDiagram),

        new Entry("STRUK Pole (JV)", "Zone 2026 · Letter Pole",
            "Junior five-member version of STRUK Pole — pole on the Centre Line, table with bucket of seven cartons behind Changeover.",
            "JUNIOR VERSION (requires 5 members). A Bending Pole is placed on the Centre Line; 3 m behind the Changeover Line is a Table holding a Bucket containing seven cartons lettered S, T, R, U, K and two blanks, with Number Five standing behind the Table. Numbers 1–4 start at the Start/Finish End. Each rider in turn rides to Number Five at the Table, receives a carton, and slots it over the Bending Pole on the Centre Line on the way back so the finished stack reads S, T, R, U, K, blank, blank top-to-bottom. Winner: Number Four first over the Start/Finish Line with all seven cartons stacked in the correct order.",
            StrukPoleJvDiagram),

        new Entry("Spell EGUK (JV)", "Zone 2026 · Spelling",
            "Junior version of Spell EGUK — four letter cards on the Centre-Line table hung by Number Five on a four-hook post.",
            "JUNIOR VERSION. A Table on the Centre Line holds four 20 cm square cards with the letters E, G, U and K (and K, U, G, E on the reverse), placed side by side and separately spaced. Number Five stands 3 m behind the Changeover Line holding a 1.22 m (4 ft) post with a single crossbar of four hooks facing Number Five. All four riders line up at the Start/Finish End. Each rider in turn picks up one card from the Centre-Line table, rides over the Changeover Line, hands the card to Number Five and waits behind the Changeover Line until Number Five hangs it on the correct hook to spell E G U K when viewed from the Start/Finish Line, then returns over the Start/Finish Line. Winner: Number Four first across the Start/Finish Line with all four cards on the hooks spelling E G U K.",
            Spell4CardsJuniorDiagram),

        new Entry("EGUK Mug Changes", "Zone 2026 · Mug",
            "Zone 2026 sponsored name for Mug Changes.",
            "Four Bending Poles 7–9 m apart, the first pole 14 m from the Start/Finish Line, mugs on Poles 2 and 4. Riders 1 & 3 start at Start/Finish; 2 & 4 at Changeover. Number One (carrying a mug) places on Pole 1, picks from Pole 2 and places on Pole 3, picks from Pole 4 and hands to Number Two. Pattern reverses going back. Mugs must be placed in correct order — any error must be corrected before continuing. Winner: Number Four first over the line, mounted, with mugs on Poles 2 and 4.",
            MugChangesDiagram),

        new Entry("2 Flag", "Zone 2026 · Flag",
            "Zone 2026 name for Two Flag — the standard run-off race.",
            "Two Flag Cones per team level with Poles 1 and 4; flag starts in the Pole 4 cone. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Each rider in turn carries a flag, places it in one cone and collects from the other. Knocked cones must be reset immediately by the rider. Winner: Number Four first over the line carrying a flag.",
            TwoFlagDiagram),

        new Entry("5 Flag", "Zone 2026 · Flag",
            "Zone 2026 name for Five Flag.",
            "A Flag Cone 3 m behind the Changeover Line and another on the Centre Line; five flags — four start in the Centre-Line cone, one carried by Number One. Each rider in turn places their flag into the Flag Cone 3 m behind the Changeover Line and collects a flag from the Centre-Line cone on the way back. Winner: Number Four first over the Start/Finish Line carrying a flag, with four flags in the cone behind the Changeover Line.",
            FiveFlagDiagram),

        // ── Area 2026 sponsored aliases + junior variants ─────────────────
        new Entry("5 Mug", "Area 2026 · Mug",
            "Area 2026 name for Five Mug – Pole Specific.",
            "Five Bending Poles 7–9 m apart; table 3 m behind Changeover with four inverted mugs (one with EGUK logo at front-left). Each rider places a mug on the designated pole (2, 3, 4 in turn) and brings back another mug. Number Four places on Pole 5, collects the EGUK mug, and places it on Pole 1 on the way back. Mugs must be replaced inverted. Winner: Number Four first over the line with a mug on every pole and the EGUK mug on Pole 1.",
            FiveMugDiagram),

        new Entry("2 Mug", "Area 2026 · Mug",
            "Area 2026 name for Two Mug.",
            "Four Bending Poles 7–9 m apart, the first pole 14 m from the Start/Finish Line; mugs on Poles 1 and 3. Numbers 1 & 3 at Start/Finish, 2 & 4 at Changeover. Number One moves Mug from 1→2 then 3→4, then crosses Changeover. Number Two moves Mug from 4→3 then 2→1, then crosses Start/Finish. Numbers 3 & 4 repeat. Mugs must move in the correct sequence — any error must be corrected. Winner: Number Four first over the line with mugs on Poles 1 and 3.",
            TwoMugDiagram),

        new Entry("PGUK Pyramid", "Area 2026 · Equipment",
            "Area 2026 name for Pyramid – PGUK Version.",
            "Table on the Centre Line and another 3 m beyond the Changeover. The Changeover table holds four unstacked 500 g plastic boxes lettered K, U, G, P (front-right, back-right, back-left, front-left as viewed from Start/Finish). Number One collects K and places it on the centre table; Number Two adds U; Number Three adds G; Number Four adds P. Stack must spell P G U K top-to-bottom. Boxes can be adjusted before/after placing.",
            PyramidDiagram),

        new Entry("PGUK Pyramid (junior version)", "Area 2026 · Equipment",
            "Junior version of PGUK Pyramid — same stacking pattern with the JV equipment set.",
            "Junior version of Pyramid – PGUK Version. Table on the Centre Line and another 3 m beyond the Changeover. JV equipment set. Stack must spell P G U K top-to-bottom.",
            PyramidDiagram),

        new Entry("Hollywood Bowl Bottle", "Area 2026 · Bottle",
            "Area 2026 sponsored name for Bottle.",
            "Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. A 750 ml bottle weighing 500 g sits on the Changeover table; another similar bottle is carried by Number One. Each rider in turn places one bottle on the centre table, collects the other from the Changeover table and hands it on. Knocked bottles/tables must be replaced upright. Winner: Number Four first over the line, mounted, carrying the bottle.",
            BottleDiagram),

        new Entry("Hollywood Bowl Bottle (junior version)", "Area 2026 · Bottle",
            "Junior version of Hollywood Bowl Bottle.",
            "Junior version. Two tables per team: one on the Centre Line, the other 3 m beyond the Changeover. JV bottle weight. Each rider in turn places one bottle on the centre table, collects the other and hands it on. Winner: Number Four first over the line carrying the bottle.",
            BottleDiagram),

        new Entry("Old Sock (junior version)", "Area 2026 · Equipment",
            "Junior version of Old Sock — four socks in a Penny Dish on a pole 3 m behind Changeover, dropped into a bucket on the Centre Line.",
            "JUNIOR VERSION. A Bucket is placed on the Centre Line and a Bending Pole topped with a Penny Dish containing four sock-balls is placed 3 m behind the Changeover Line. Number One starts carrying a fifth sock. Each rider in turn drops the sock they carry into the Centre-Line bucket, rides across the Changeover Line, collects a sock from the Penny Dish (mounted) and returns to hand it to the next rider. Number Four drops the final sock into the bucket on the way back. Winner: first Number Four over the Start/Finish Line with five socks in the bucket.",
            OldSockJvDiagram),

        new Entry("Old Sock (JV)", "Area 2026 · Equipment",
            "Junior version of Old Sock — four socks in a Penny Dish on a pole 3 m behind Changeover, dropped into a bucket on the Centre Line.",
            "JUNIOR VERSION. A Bucket is placed on the Centre Line and a Bending Pole topped with a Penny Dish containing four sock-balls is placed 3 m behind the Changeover Line. Number One starts carrying a fifth sock. Each rider in turn drops the sock they carry into the Centre-Line bucket, rides across the Changeover Line, collects a sock from the Penny Dish (mounted) and returns to hand it to the next rider. Number Four drops the final sock into the bucket on the way back. Winner: first Number Four over the Start/Finish Line with five socks in the bucket.",
            OldSockJvDiagram),

        new Entry("EGUK 5 Flag", "Area 2026 · Flag",
            "Area 2026 sponsored name for 5 Flag / Five Flag.",
            "A Flag Cone 3 m behind the Changeover Line and another on the Centre Line; five flags — four start in the Centre-Line cone, one carried by Number One. Each rider in turn places their flag into the Flag Cone 3 m behind the Changeover Line and collects a flag from the Centre-Line cone on the way back. Winner: Number Four first over the Start/Finish Line carrying a flag, with four flags in the cone behind the Changeover Line.",
            FiveFlagDiagram),
    };
}
