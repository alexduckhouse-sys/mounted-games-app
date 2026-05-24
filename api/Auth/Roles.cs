namespace MountedGames.Api.Auth;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Trainer = "Trainer";
    public const string Rider = "Rider";

    public static readonly string[] All = { Admin, Trainer, Rider };
}
