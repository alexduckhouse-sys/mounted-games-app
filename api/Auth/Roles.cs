namespace MountedGames.Api.Auth;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Trainer = "Trainer";
    public const string Manager = "Manager";
    public const string Member = "Member";
    public const string Rider = "Rider";

    public static readonly string[] All = { Admin, Trainer, Manager, Member, Rider };

    /// <summary>
    /// Anyone with team-level access — trainer, manager or member of a pony
    /// club. All three behave the same today (they can see dec forms, submit
    /// declarations, view their club's teams). The labels are mostly for
    /// the user's own self-identification on signup.
    /// </summary>
    public const string TeamMember = Trainer + "," + Manager + "," + Member;

    /// <summary>Anyone authorised to organise / edit a competition (admin + trainer + manager).</summary>
    public const string Organiser = Admin + "," + Trainer + "," + Manager;

    /// <summary>Admin OR any team-level role — gates dec-form submit + similar shared-team work.</summary>
    public const string TeamWork = Admin + "," + Trainer + "," + Manager + "," + Member;
}
