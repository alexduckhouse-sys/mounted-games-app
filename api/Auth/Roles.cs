namespace MountedGames.Api.Auth;

public static class Roles
{
    public const string Admin = "Admin";
    /// <summary>
    /// Above Admin: can lock and unlock Admin and organiser accounts. An account holds this <em>as well as</em> Admin, so
    /// every Admin check still passes. It can't be granted through the API (see <see cref="Assignable"/>).
    /// </summary>
    public const string MasterAdmin = "MasterAdmin";
    public const string Trainer = "Trainer";
    public const string TrainerRequest = "TrainerRequest";
    /// <summary>A signed-up team manager awaiting admin approval; they hold Member access until then.</summary>
    public const string ManagerRequest = "ManagerRequest";
    public const string Manager = "Manager";
    public const string Member = "Member";
    public const string Rider = "Rider";

    public static readonly string[] All = { Admin, MasterAdmin, Trainer, TrainerRequest, ManagerRequest, Manager, Member, Rider };

    /// <summary>Roles an admin may hand out when making an account. MasterAdmin is never one of them.</summary>
    public static readonly string[] Assignable = All.Where(r => r != MasterAdmin).ToArray();

    /// <summary>
    /// Anyone with team-level access — trainer, manager or member of a pony
    /// club. All three behave the same today (they can see dec forms, submit
    /// declarations, view their club's teams). The labels are mostly for
    /// the user's own self-identification on signup.
    /// </summary>
    public const string TeamMember = Trainer + "," + Manager + "," + Member;

    /// <summary>Anyone authorised to organise / edit a competition (admin + competition-owning trainer).</summary>
    public const string Organiser = Admin + "," + Trainer;

    /// <summary>Admin OR any team-level role — gates dec-form submit + similar shared-team work.</summary>
    public const string TeamWork = Admin + "," + Trainer + "," + Manager + "," + Member;
}
