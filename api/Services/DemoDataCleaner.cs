using System.Globalization;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Services;

/// <summary>What <c>--clear-demo-data</c> was asked to do. Without <see cref="Apply"/> it is a dry run.</summary>
/// <remarks><see cref="ExpectName"/> must equal the kept competition's name exactly, so a mistyped id stops the run.</remarks>
public sealed record DemoDataCleanOptions(int KeepCompetitionId, string ExpectName, bool Apply = false, string? VenuePostcode = null);

/// <summary>A refusal: the message says why, and that nothing was changed.</summary>
public sealed class DemoDataCleanException(string message) : Exception(message);

/// <summary>Rows in one table before and after the run.</summary>
public sealed record DemoDataTableCount(string Table, long Before, long After)
{
    public long Deleted => Before - After;
}

/// <summary>Accounts by kind. Counts only: never names or addresses.</summary>
public sealed record DemoDataAccountCounts(int Deleted, int Admins, int RealSignups, int SeededKeptForEvent);

/// <summary>Clubs by kind. <see cref="DeletedNames"/> lists the clubs going (club names are not personal data).</summary>
public sealed record DemoDataClubCounts(IReadOnlyList<string> DeletedNames, int KeptInUse, int KeptPreset)
{
    public int Deleted => DeletedNames.Count;
}

/// <summary>The venue postcode to set on the kept competition and where it is (looked up in the dry run too).</summary>
public sealed record DemoDataPostcode(string Postcode, double Latitude, double Longitude);

public sealed record DemoDataCleanResult(
    bool Applied,
    string Database,
    int KeptCompetitionId,
    string KeptCompetitionName,
    IReadOnlyList<(string Label, int Count)> KeptCompetition,
    IReadOnlyList<(int Id, string Name)> DeletedCompetitions,
    DemoDataAccountCounts Accounts,
    DemoDataClubCounts Clubs,
    int TeamProfilesKept,
    DemoDataPostcode? Postcode,
    IReadOnlyList<DemoDataTableCount> Tables)
{
    /// <summary>
    /// The printed report: counts, competition ids and names (public), and table names. Never a person's name or address.
    /// </summary>
    public IEnumerable<string> Report()
    {
        yield return $"Database: {Database}.";
        yield return Applied
            ? "Applied: everything below was deleted in one transaction."
            : "Dry run: nothing has been changed. The deletes ran inside a transaction that was rolled back, "
                + "so these are exactly the rows --apply would remove. Add --apply to delete them.";
        yield return "";
        var kept = KeptCompetition.Where(x => x.Count > 0).Select(x => Say(x.Count, x.Label)).ToList();
        yield return $"Keeping competition {KeptCompetitionId} \"{KeptCompetitionName}\""
            + (kept.Count == 0 ? "." : $": {string.Join(", ", kept)}.");
        yield return $"{(Applied ? "Checked" : "Checked inside the rolled-back transaction")}: competition {KeptCompetitionId} "
            + "still has all of that afterwards.";
        yield return "";
        yield return DeletedCompetitions.Count == 0
            ? "No other competitions to delete."
            : $"{(Applied ? "Deleted" : "Would delete")} {Say(DeletedCompetitions.Count, "other competitions")}, with everything under them:";
        foreach (var (id, name) in DeletedCompetitions)
            yield return $"  {id} \"{name}\"";
        yield return "";
        yield return $"Accounts: {(Applied ? "deleted" : "would delete")} {Accounts.Deleted} made by the seeders; keeping "
            + $"{Accounts.Admins + Accounts.RealSignups + Accounts.SeededKeptForEvent} ({Say(Accounts.Admins, "site admins")}, "
            + $"{Say(Accounts.RealSignups, "real sign-ups")}, {Say(Accounts.SeededKeptForEvent, "seeder accounts")} the kept competition uses).";
        yield return "  Seeder accounts are recognised only by their fixed markers: the history seed's ids (history-seed-*) and "
            + "@history-seed.invalid addresses, and the two demo trainer addresses of the local demo data. Site admins are never deleted.";
        yield return $"Team profiles: keeping {Say(TeamProfilesKept, "team profiles")} owned by real accounts (or linked to the kept competition).";
        yield return $"Clubs: {(Applied ? "deleted" : "would delete")} {Clubs.Deleted} that nothing kept uses; keeping "
            + $"{Clubs.KeptInUse + Clubs.KeptPreset} ({Clubs.KeptInUse} in use, {Clubs.KeptPreset} more from the preset club list).";
        foreach (var name in Clubs.DeletedNames)
            yield return $"  \"{name}\"";
        if (Postcode is not null)
            yield return $"Postcode: {(Applied ? "set" : "would set")} competition {KeptCompetitionId}'s postcode to {Postcode.Postcode} "
                + $"({Coordinate(Postcode.Latitude)}, {Coordinate(Postcode.Longitude)}).";
        yield return "";
        yield return "Rows per table:";
        var width = Math.Max(5, Tables.Max(t => t.Table.Length));
        yield return $"  {"Table".PadRight(width)}  {"Before",8}  {(Applied ? "Deleted" : "Delete"),8}  {"Kept",8}";
        foreach (var t in Tables.Where(t => t.Before > 0))
            yield return $"  {t.Table.PadRight(width)}  {t.Before,8}  {t.Deleted,8}  {t.After,8}";
        var empty = Tables.Count(t => t.Before == 0);
        if (empty > 0) yield return $"  ({empty} other {(empty == 1 ? "table is" : "tables are")} empty)";
    }

    /// <summary>"1 section", "2 sections": each report label is plural, made singular for a count of one.</summary>
    internal static string Say(int count, string plural) => $"{count} {(count == 1 ? Singular(plural) : plural)}";

    private static string Singular(string plural) => plural switch
    {
        "entries" => "entry",
        "results for its teams" => "result for its teams",
        "lanes for its teams" => "lane for its teams",
        "clubs its teams use" => "club its teams use",
        "chat messages with an author" => "chat message with an author",
        "other competitions" => "other competition",
        _ when plural.EndsWith("ies", StringComparison.Ordinal) => plural[..^3] + "y",
        _ when plural.EndsWith('s') => plural[..^1],
        _ => plural,
    };

    private static string Coordinate(double? value) => value?.ToString("0.#####", CultureInfo.InvariantCulture) ?? "?";
}

/// <summary>
/// One-off command (<c>--clear-demo-data --keep-competition &lt;id&gt; [--apply] [--venue-postcode "&lt;postcode&gt;"]</c>): removes
/// every competition but one, with everything under them, plus all seasons, team profiles, the seeders' accounts and what
/// they own, and clubs nothing kept uses. The kept competition and everything that belongs to or is used by it stays, as do
/// site admins and every account a person made. All deletes run in one transaction; a dry run (no <c>--apply</c>) rolls it
/// back, so its counts are exactly what <c>--apply</c> would remove. Afterwards it checks the kept competition lost nothing
/// and that no row points at something that was deleted, and rolls back if either fails. See docs/decisions.md, 28 Oct.
/// </summary>
public static class DemoDataCleaner
{
    public const string Flag = "--clear-demo-data";
    private const int MaxPostcodeLength = 12;

    /// <summary>Reads the command's arguments. Returns false with a message when they are missing or malformed.</summary>
    public static bool TryParse(string[] args, out DemoDataCleanOptions? options, out string? problem)
    {
        options = null;
        var keep = ValueAfter(args, "--keep-competition");
        if (keep is null || !int.TryParse(keep, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
        {
            problem = "Say which competition to keep: --keep-competition <id>, for example --keep-competition 44. "
                + "Nothing was changed.";
            return false;
        }
        var expectName = ValueAfter(args, "--expect-name");
        if (string.IsNullOrEmpty(expectName))
        {
            problem = "Say the kept competition's exact name too: --expect-name \"<name>\", for example "
                + "--expect-name \"West Mids Pairs\". Nothing was changed.";
            return false;
        }
        string? postcode = null;
        if (args.Contains("--venue-postcode"))
        {
            postcode = CompetitionFields.Postcode(ValueAfter(args, "--venue-postcode"));
            if (postcode is null || postcode.Length > MaxPostcodeLength)
            {
                problem = $"Give the venue postcode after --venue-postcode, for example --venue-postcode \"CV8 2LZ\" "
                    + $"(at most {MaxPostcodeLength} characters). Nothing was changed.";
                return false;
            }
        }
        options = new DemoDataCleanOptions(id, expectName, args.Contains("--apply"), postcode);
        problem = null;
        return true;
    }

    private static string? ValueAfter(string[] args, string flag)
    {
        var at = Array.IndexOf(args, flag);
        var value = at < 0 || at + 1 >= args.Length ? null : args[at + 1];
        return value is null || value.StartsWith("--", StringComparison.Ordinal) ? null : value;
    }

    /// <summary>The command as Program.cs runs it. Returns the process exit code.</summary>
    public static async Task<int> RunCommandAsync(
        IServiceProvider services, string[] args, TextWriter output, TextWriter error, CancellationToken ct = default)
    {
        if (!TryParse(args, out var options, out var problem))
        {
            error.WriteLine(problem);
            return 1;
        }
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Deliberately no DbInitializer.SeedAsync: a dry run must not write anything, not even reference data.
            if (db.Database.IsNpgsql() && (await db.Database.GetPendingMigrationsAsync(ct)).Any())
            {
                error.WriteLine("This database has migrations still to apply. Run npm run db:migrate first. Nothing was changed.");
                return 1;
            }
            var result = await ClearAsync(db, options!, scope.ServiceProvider.GetRequiredService<GeocodingService>(), ct);
            foreach (var line in result.Report())
                output.WriteLine(line);
            return 0;
        }
        catch (DemoDataCleanException ex)
        {
            error.WriteLine(ex.Message);
            return 1;
        }
        catch (Exception ex)
        {
            // The database's own message can carry connection details or row values, so only the kind of failure is shown.
            error.WriteLine($"The run stopped with an unexpected error ({ex.GetType().Name}). Nothing was committed: the "
                + "transaction, if it had started, was rolled back. Run the dry run again to see where things stand.");
            return 1;
        }
    }

    public static async Task<DemoDataCleanResult> ClearAsync(
        AppDbContext db, DemoDataCleanOptions options, GeocodingService geocoder, CancellationToken ct = default)
    {
        db.ChangeTracker.Clear();
        var k = options.KeepCompetitionId;
        var kept = await db.Competitions.AsNoTracking().Where(c => c.Id == k)
            .Select(c => new { c.Id, c.Name, c.DecFormConfigJson })
            .FirstOrDefaultAsync(ct)
            ?? throw new DemoDataCleanException($"There is no competition {k}, so nothing was changed.");
        if (!string.Equals(kept.Name, options.ExpectName, StringComparison.Ordinal))
            throw new DemoDataCleanException($"Competition {k} is called \"{kept.Name}\", not \"{options.ExpectName}\", so "
                + "nothing was changed. Check the id and the name.");
        if (await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == k && x.IsDemo, ct))
            throw new DemoDataCleanException($"Competition {k} \"{kept.Name}\" is marked as a demo event, so it is unlikely to be "
                + "the one to keep. Nothing was changed.");

        // Look the postcode up (in the dry run too: the lookup only reads) before anything is deleted, so a typo stops the run.
        DemoDataPostcode? postcode = null;
        if (CompetitionFields.Postcode(options.VenuePostcode) is { } wanted)
        {
            var (lat, lon) = await geocoder.ResolvePostcodeAsync(wanted, ct);
            if (lat is null || lon is null)
                throw new DemoDataCleanException($"Couldn't find where {wanted} is, so nothing was changed. "
                    + "Check the postcode and run again.");
            postcode = new DemoDataPostcode(wanted, lat.Value, lon.Value);
        }

        var payoutClubId = DecFormConfig.Parse(kept.DecFormConfigJson)?.PayoutClubId;
        var database = DatabaseLabel(db);

        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var result = await DeleteAsync(db, k, kept.Name, payoutClubId, postcode, options.Apply, database, ct);
            if (options.Apply) await transaction.CommitAsync(ct);
            else await transaction.RollbackAsync(ct);
            return result;
        });
    }

    private static async Task<DemoDataCleanResult> DeleteAsync(
        AppDbContext db, int k, string keptName, int? payoutClubId, DemoDataPostcode? postcode, bool apply, string database,
        CancellationToken ct)
    {
        var tables = Tables(db);
        var before = new Dictionary<string, long>();
        foreach (var table in tables) before[table.Name] = await CountAsync(db, $"SELECT COUNT(*) AS \"Value\" FROM {table.Sql}", ct);
        var danglingBefore = await DanglingAsync(db, tables, ct);
        var snapshot = await SnapshotAsync(db, k, ct);

        var deletedCompetitions = (await db.Competitions.Where(c => c.Id != k).OrderBy(c => c.Id)
            .Select(c => new { c.Id, c.Name }).ToListAsync(ct)).Select(c => (c.Id, c.Name)).ToList();

        // Accounts, decided before anything goes: seeder-made ones, less site admins and any the kept event uses.
        var seeded = await SeededAccountIdsAsync(db, ct);
        var adminRoles = new[] { Roles.Admin, Roles.MasterAdmin };
        var admins = (await db.UserRoles
            .Where(ur => db.Roles.Any(r => r.Id == ur.RoleId && r.Name != null && adminRoles.Contains(r.Name)))
            .Select(ur => ur.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var usedByKept = await AccountsUsedByAsync(db, k, ct);
        var gone = seeded.Where(id => !admins.Contains(id) && !usedByKept.Contains(id)).ToList();
        // Arrays, not sets, in queries: Npgsql binds arrays and lists as parameters.
        var seededIds = seeded.ToArray();
        var adminIds = admins.ToArray();
        var accounts = new DemoDataAccountCounts(
            gone.Count,
            admins.Count,
            await db.Users.CountAsync(u => !seededIds.Contains(u.Id) && !adminIds.Contains(u.Id), ct),
            seeded.Count(id => !admins.Contains(id) && usedByKept.Contains(id)));

        // 1. Every season with its standings (a round points at its event with a restricting key).
        await db.Set<SeasonRoundResult>().ExecuteDeleteAsync(ct);
        await db.Set<SeasonRoundPublication>().ExecuteDeleteAsync(ct);
        await db.Set<SeasonRound>().ExecuteDeleteAsync(ct);
        await db.Set<SeasonPlacePoints>().ExecuteDeleteAsync(ct);
        await db.Set<Season>().ExecuteDeleteAsync(ct);

        // 2. Every other competition and its whole graph, through the one maintained list of competition-keyed tables.
        if (deletedCompetitions.Count > 0)
            await ReviewCompetitionSeeder.DeleteCompetitionGraphAsync(db, deletedCompetitions.Select(c => c.Id).ToList());

        // 3. Team profiles with no owner or a seeder owner that goes, unless linked to the kept competition (only its links
        //    are left now). A profile a person owns stays.
        await db.Set<TeamProfile>()
            .Where(p => (p.OwnerUserId == "" || gone.Contains(p.OwnerUserId))
                && !db.Set<EventTeamProfileLink>().Any(l => l.TeamProfileId == p.Id))
            .ExecuteDeleteAsync(ct);
        var teamProfilesKept = await db.Set<TeamProfile>().CountAsync(ct);

        // 4. Rider rosters the seeders made, unless a kept dec form was filled from one.
        var demoRosterIds = await SeededSavedRiderIdsAsync(db, gone, ct);
        await db.SavedRiders.Where(r => demoRosterIds.Contains(r.Id)).ExecuteDeleteAsync(ct);

        // 5. The seeders' accounts and everything they own.
        if (gone.Count > 0) await DeleteAccountsAsync(db, gone, ct);

        // 6. Clubs nothing kept uses. The preset club list is reference data: startup adds it back, so it stays.
        var clubs = await ClubsAsync(db, payoutClubId, ct);

        // 7. The venue, as the organiser's own edit would set it.
        if (postcode is not null)
            await db.Competitions.Where(c => c.Id == k).ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Postcode, postcode.Postcode)
                .SetProperty(c => c.Latitude, (double?)postcode.Latitude)
                .SetProperty(c => c.Longitude, (double?)postcode.Longitude), ct);

        // Checks: the kept competition lost nothing, and nothing points at a deleted row that didn't before.
        var after = await SnapshotAsync(db, k, ct);
        foreach (var ((label, was), (_, now)) in snapshot.Zip(after))
            if (was != now)
                throw new DemoDataCleanException($"Competition {k} would have gone from {was} to {now} {label}, so nothing was "
                    + "changed. Something under it points at data being deleted; look into that first.");
        var danglingAfter = await DanglingAsync(db, tables, ct);
        foreach (var (reference, count) in danglingAfter)
            if (count > danglingBefore[reference])
                throw new DemoDataCleanException($"{count - danglingBefore[reference]} rows in {reference} would point at something "
                    + "that was deleted, so nothing was changed. Add that table to ReviewCompetitionSeeder.DeleteCompetitionGraphAsync.");

        var counts = new List<DemoDataTableCount>();
        foreach (var table in tables)
            counts.Add(new DemoDataTableCount(table.Name, before[table.Name],
                await CountAsync(db, $"SELECT COUNT(*) AS \"Value\" FROM {table.Sql}", ct)));
        return new DemoDataCleanResult(apply, database, k, keptName, snapshot, deletedCompetitions, accounts, clubs,
            teamProfilesKept, postcode, counts);
    }

    // ----- accounts -----

    /// <summary>
    /// Accounts the seeders made, by their exact markers only: <see cref="HistorySeeder"/>'s fixed ids and its
    /// <c>@history-seed.invalid</c> addresses, and the demo trainers <see cref="DbInitializer.SeedDemoDataAsync"/> makes.
    /// The shared admin (<c>admin@mg.local</c>) is an Admin, made at every production start when Admin:Key is set, and kept.
    /// The review seeder makes no accounts.
    /// </summary>
    private static async Task<HashSet<string>> SeededAccountIdsAsync(AppDbContext db, CancellationToken ct)
    {
        var historyIds = HistorySeeder.SellerIds.Append(HistorySeeder.OrganiserId).ToArray();
        var demoEmails = DbInitializer.DemoTrainerEmails.Select(e => e.ToUpperInvariant()).ToArray();
        return (await db.Users
            .Where(u => historyIds.Contains(u.Id)
                || (u.NormalizedEmail != null && (u.NormalizedEmail.EndsWith("@HISTORY-SEED.INVALID") || demoEmails.Contains(u.NormalizedEmail))))
            .Select(u => u.Id).ToListAsync(ct)).ToHashSet();
    }

    /// <summary>Every account the kept competition refers to: its owner, staff, trainers, entrants, buyers and sellers.</summary>
    private static async Task<HashSet<string>> AccountsUsedByAsync(AppDbContext db, int k, CancellationToken ct)
    {
        var sections = db.CompetitionSections.Where(s => s.CompetitionId == k).Select(s => s.Id);
        var teams = db.Teams.Where(t => t.CompetitionId == k).Select(t => t.Id);
        var orders = db.Set<EventOrder>().Where(o => o.CompetitionId == k).Select(o => o.Id);
        var listedItems = db.Set<CompetitionListing>().Where(l => l.CompetitionId == k).Select(l => l.CatalogueItemId);
        var shifts = db.Set<VolunteerShift>().Where(s => s.CompetitionId == k).Select(s => s.Id);
        var profiles = db.Set<EventTeamProfileLink>().Where(l => l.CompetitionId == k).Select(l => l.TeamProfileId);
        var queries = new IQueryable<string?>[]
        {
            db.Competitions.Where(c => c.Id == k).Select(c => c.CreatedByUserId),
            db.CompetitionCollaborators.Where(c => c.CompetitionId == k).Select(c => (string?)c.UserId),
            db.CompetitionCollaborators.Where(c => c.CompetitionId == k).Select(c => (string?)c.AddedByUserId),
            db.Teams.Where(t => t.CompetitionId == k).Select(t => t.TrainerUserId),
            db.TeamSupporters.Where(s => teams.Contains(s.TeamId)).Select(s => (string?)s.UserId),
            db.DeclarationForms.Where(d => teams.Contains(d.TeamId)).Select(d => d.SubmittedByUserId),
            db.SectionSignups.Where(s => sections.Contains(s.CompetitionSectionId)).Select(s => s.UserId),
            db.SectionSignups.Where(s => sections.Contains(s.CompetitionSectionId)).Select(s => s.TermsAcceptedByUserId),
            db.DeclarationForms.Where(d => teams.Contains(d.TeamId)).Select(d => d.TermsAcceptedByUserId),
            db.ChatMessages.Where(m => m.CompetitionId == k).Select(m => m.UserId),
            db.ChatMessages.Where(m => m.CompetitionId == k).Select(m => m.RecipientUserId),
            db.Set<EventOrder>().Where(o => o.CompetitionId == k).Select(o => (string?)o.BuyerUserId),
            db.Set<EventOrderLine>().Where(l => orders.Contains(l.EventOrderId)).Select(l => (string?)l.SellerUserId),
            db.Set<CompetitionListing>().Where(l => l.CompetitionId == k).Select(l => (string?)l.SellerUserId),
            db.Set<CatalogueItem>().Where(i => listedItems.Contains(i.Id)).Select(i => (string?)i.SellerUserId),
            db.Set<VolunteerClaim>().Where(c => shifts.Contains(c.ShiftId)).Select(c => (string?)c.UserId),
            db.Set<EventTeamProfileLink>().Where(l => l.CompetitionId == k).Select(l => (string?)l.LinkedByUserId),
            db.Set<TeamProfile>().Where(p => profiles.Contains(p.Id)).Select(p => (string?)p.OwnerUserId),
            db.LiveStreams.Where(s => s.CompetitionId == k).Select(s => (string?)s.StartedByUserId),
        };
        var used = new HashSet<string>();
        foreach (var query in queries)
            foreach (var id in await query.Where(id => id != null).Distinct().ToListAsync(ct))
                used.Add(id!);
        return used;
    }

    /// <summary>Removes the accounts and every row that is theirs alone, as AccountDeletionService does for a real one.</summary>
    private static async Task DeleteAccountsAsync(AppDbContext db, List<string> gone, CancellationToken ct)
    {
        // Their shop items (with sizes and any listings left) and marketplace posts (with comments and reports).
        var items = db.Set<CatalogueItem>().Where(i => gone.Contains(i.SellerUserId)).Select(i => i.Id);
        await db.Set<CompetitionListing>().Where(l => items.Contains(l.CatalogueItemId)).ExecuteDeleteAsync(ct);
        await db.Set<CatalogueItemOption>().Where(o => items.Contains(o.CatalogueItemId)).ExecuteDeleteAsync(ct);
        await db.Set<CatalogueItem>().Where(i => gone.Contains(i.SellerUserId)).ExecuteDeleteAsync(ct);
        var posts = db.ShopPosts.Where(p => p.AuthorUserId != null && gone.Contains(p.AuthorUserId)).Select(p => p.Id);
        await db.ShopComments.Where(c => posts.Contains(c.PostId) || (c.AuthorUserId != null && gone.Contains(c.AuthorUserId)))
            .ExecuteDeleteAsync(ct);
        await db.ShopReports.Where(r => posts.Contains(r.PostId) || (r.ReporterUserId != null && gone.Contains(r.ReporterUserId)))
            .ExecuteDeleteAsync(ct);
        await db.ShopPosts.Where(p => p.AuthorUserId != null && gone.Contains(p.AuthorUserId)).ExecuteDeleteAsync(ct);
        await db.ShopComments.Where(c => c.ToUserId != null && gone.Contains(c.ToUserId))
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.ToUserId, (string?)null), ct);
        await db.ShopPosts.Where(p => p.DeletedByUserId != null && gone.Contains(p.DeletedByUserId))
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.DeletedByUserId, (string?)null), ct);

        // Their own rows (several cascade in the database too; removed here so nothing depends on that).
        await db.Set<SubstitutionRequest>().Where(r => gone.Contains(r.RequestedByUserId)).ExecuteDeleteAsync(ct);
        await db.Set<SubstitutionRequest>().Where(r => r.DecidedByUserId != null && gone.Contains(r.DecidedByUserId))
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.DecidedByUserId, (string?)null), ct);
        await db.TrainerNotes.Where(n => gone.Contains(n.UserId)).ExecuteDeleteAsync(ct);
        await db.StartingPoints.Where(p => gone.Contains(p.OwnerUserId)).ExecuteDeleteAsync(ct);
        await db.AccountIps.Where(a => gone.Contains(a.UserId)).ExecuteDeleteAsync(ct);
        await db.IpBlocks.Where(b => b.BlockedAccountUserId != null && gone.Contains(b.BlockedAccountUserId)).ExecuteDeleteAsync(ct);
        await db.PasswordResetTokens.Where(t => gone.Contains(t.UserId)).ExecuteDeleteAsync(ct);
        await db.PushSubscriptions.Where(p => gone.Contains(p.UserId)).ExecuteDeleteAsync(ct);
        await db.OverlayLooks.Where(l => gone.Contains(l.OwnerUserId)).ExecuteDeleteAsync(ct);
        await db.TeamSupporters.Where(s => gone.Contains(s.UserId)).ExecuteDeleteAsync(ct);
        await db.CompetitionCollaborators.Where(c => gone.Contains(c.UserId)).ExecuteDeleteAsync(ct);
        await db.Set<VolunteerClaim>().Where(c => gone.Contains(c.UserId)).ExecuteDeleteAsync(ct);
        await db.UserRoles.Where(r => gone.Contains(r.UserId)).ExecuteDeleteAsync(ct);
        await db.UserClaims.Where(c => gone.Contains(c.UserId)).ExecuteDeleteAsync(ct);
        await db.UserLogins.Where(l => gone.Contains(l.UserId)).ExecuteDeleteAsync(ct);
        await db.UserTokens.Where(t => gone.Contains(t.UserId)).ExecuteDeleteAsync(ct);
        await db.Users.Where(u => gone.Contains(u.Id)).ExecuteDeleteAsync(ct);
    }

    /// <summary>
    /// Saved riders the seeders made: those made by a seeder account that is being deleted (a kept one keeps its riders), and
    /// the local demo data's eight (no creator, on two preset club rosters, matched on club, name and pony together). One a
    /// kept dec form uses stays.
    /// The names are compared here and never printed.
    /// </summary>
    private static async Task<List<int>> SeededSavedRiderIdsAsync(AppDbContext db, List<string> gone, CancellationToken ct)
    {
        var demo = DbInitializer.DemoSavedRiders;
        var demoClubs = demo.Select(r => r.Club).Distinct().ToArray();
        var demoNames = demo.Select(r => r.Name).ToArray();
        var candidates = await db.SavedRiders
            .Where(r => !db.RiderEntries.Any(e => e.SavedRiderId == r.Id)
                && ((r.CreatedByUserId != null && gone.Contains(r.CreatedByUserId))
                    || (r.CreatedByUserId == null && demoNames.Contains(r.FullName)
                        && db.Clubs.Any(c => c.Id == r.ClubId && demoClubs.Contains(c.Name)))))
            .Select(r => new { r.Id, r.CreatedByUserId, r.FullName, r.HorseName, Club = r.Club!.Name })
            .ToListAsync(ct);
        return candidates
            .Where(r => r.CreatedByUserId != null || demo.Contains((r.Club, r.FullName, r.HorseName ?? "")))
            .Select(r => r.Id).ToList();
    }

    // ----- clubs -----

    private static async Task<DemoDataClubCounts> ClubsAsync(AppDbContext db, int? payoutClubId, CancellationToken ct)
    {
        var preset = new HashSet<string>(DbInitializer.PresetClubNames, StringComparer.OrdinalIgnoreCase);
        var used = new HashSet<int>();
        foreach (var query in new IQueryable<int>[]
        {
            db.Teams.Select(t => t.ClubId),
            db.Users.Where(u => u.ClubId != null).Select(u => u.ClubId!.Value),
            db.SavedRiders.Select(r => r.ClubId),
            db.Set<TeamProfile>().Select(p => p.ClubId),
            db.ClubPayoutAccounts.Select(a => a.ClubId),
        })
            used.UnionWith(await query.Distinct().ToListAsync(ct));
        if (payoutClubId is { } pinned) used.Add(pinned);
        var clubs = await db.Clubs.Select(c => new { c.Id, c.Name }).ToListAsync(ct);
        var unused = clubs.Where(c => !used.Contains(c.Id) && !preset.Contains(c.Name))
            .OrderBy(c => c.Name, StringComparer.Ordinal).ToList();
        var unusedIds = unused.Select(c => c.Id).ToList();
        await db.Clubs.Where(c => unusedIds.Contains(c.Id)).ExecuteDeleteAsync(ct);
        var inUse = clubs.Count(c => used.Contains(c.Id));
        return new DemoDataClubCounts(unused.Select(c => c.Name).ToList(), inUse, clubs.Count - unused.Count - inUse);
    }

    // ----- checks -----

    /// <summary>What the kept competition holds. Compared before and after the deletes; any difference rolls back.</summary>
    private static async Task<List<(string Label, int Count)>> SnapshotAsync(AppDbContext db, int k, CancellationToken ct)
    {
        var sections = db.CompetitionSections.Where(s => s.CompetitionId == k).Select(s => s.Id);
        var sessions = db.Sessions.Where(s => s.CompetitionId == k).Select(s => s.Id);
        var heats = db.Heats.Where(h => sessions.Contains(h.SessionId)).Select(h => h.Id);
        var races = db.Races.Where(r => heats.Contains(r.HeatId)).Select(r => r.Id);
        var teams = db.Teams.Where(t => t.CompetitionId == k).Select(t => t.Id);
        var forms = db.DeclarationForms.Where(d => teams.Contains(d.TeamId)).Select(d => d.Id);
        var signups = db.SectionSignups.Where(s => sections.Contains(s.CompetitionSectionId)).Select(s => s.Id);
        var shifts = db.Set<VolunteerShift>().Where(s => s.CompetitionId == k).Select(s => s.Id);
        var clubIds = db.Teams.Where(t => t.CompetitionId == k).Select(t => t.ClubId);
        var ownerId = db.Competitions.Where(c => c.Id == k).Select(c => c.CreatedByUserId);
        return
        [
            ("sections", await sections.CountAsync(ct)),
            ("sessions", await sessions.CountAsync(ct)),
            ("heats", await heats.CountAsync(ct)),
            ("lanes", await db.HeatEntries.CountAsync(e => heats.Contains(e.HeatId), ct)),
            ("races", await races.CountAsync(ct)),
            ("results", await db.Results.CountAsync(r => races.Contains(r.RaceId), ct)),
            ("teams", await teams.CountAsync(ct)),
            ("dec forms", await forms.CountAsync(ct)),
            ("riders", await db.RiderEntries.CountAsync(r => forms.Contains(r.DeclarationFormId), ct)),
            ("entries", await signups.CountAsync(ct)),
            ("entry details", await db.Set<SignupExtras>().CountAsync(x => signups.Contains(x.SignupId), ct)
                + await db.Set<SignupGuestDetails>().CountAsync(x => signups.Contains(x.SignupId), ct)
                + await db.Set<SignupMatchmaking>().CountAsync(x => signups.Contains(x.SignupId), ct)
                + await db.Set<SignupTeamLink>().CountAsync(x => signups.Contains(x.SignupId), ct)),
            ("results for its teams", await db.Results.CountAsync(r => teams.Contains(r.TeamId), ct)),
            ("lanes for its teams", await db.HeatEntries.CountAsync(e => teams.Contains(e.TeamId), ct)),
            ("clubs its teams use", await db.Clubs.CountAsync(c => clubIds.Contains(c.Id), ct)),
            ("owner accounts", await db.Users.CountAsync(u => ownerId.Contains(u.Id), ct)),
            ("competition admins", await db.CompetitionCollaborators.CountAsync(c => c.CompetitionId == k, ct)),
            ("supporters", await db.TeamSupporters.CountAsync(s => teams.Contains(s.TeamId), ct)),
            ("sponsors", await db.Sponsors.CountAsync(s => s.CompetitionId == k, ct)),
            ("chat messages", await db.ChatMessages.CountAsync(m => m.CompetitionId == k, ct)),
            ("chat messages with an author", await db.ChatMessages.CountAsync(m => m.CompetitionId == k && m.UserId != null, ct)),
            ("scorer links", await db.ScorerLinks.CountAsync(s => s.CompetitionId == k, ct)),
            ("live streams", await db.LiveStreams.CountAsync(s => s.CompetitionId == k, ct)),
            ("shop orders", await db.Set<EventOrder>().CountAsync(o => o.CompetitionId == k, ct)),
            ("shop listings", await db.Set<CompetitionListing>().CountAsync(l => l.CompetitionId == k, ct)),
            ("test payments", await db.Set<TestPaymentRecord>().CountAsync(p => p.CompetitionId == k, ct)),
            ("volunteer shifts", await shifts.CountAsync(ct)),
            ("volunteer claims", await db.Set<VolunteerClaim>().CountAsync(c => shifts.Contains(c.ShiftId), ct)),
            ("score records", await db.Set<RaceScoreState>().CountAsync(s => races.Contains(s.RaceId), ct)
                + await db.Set<RaceScoreEvent>().CountAsync(s => races.Contains(s.RaceId), ct)),
            ("team status changes", await db.Set<TeamStatusEvent>().CountAsync(e => e.CompetitionId == k, ct)),
            ("chat reports", await db.ChatReports.CountAsync(r => r.Message.CompetitionId == k, ct)),
            ("scheduled notifications", await db.ScheduledNotifications.CountAsync(n => n.CompetitionId == k, ct)),
            ("protests", await db.Set<Protest>().CountAsync(p => p.CompetitionId == k, ct)),
            ("draw changes", await db.Set<DrawChange>().CountAsync(e => e.CompetitionId == k, ct)),
            ("rider swaps", await db.Set<RiderSwapEvent>().CountAsync(e => e.CompetitionId == k, ct)),
            ("special awards", await db.SpecialAwards.CountAsync(a => a.CompetitionId == k, ct)),
            ("finals tie orders", await db.FinalsTieOrders.CountAsync(o => o.CompetitionId == k, ct)),
            ("tack checks", await db.Set<TackCheckSection>().CountAsync(t => t.CompetitionId == k, ct)),
            ("passport checks", await db.Set<PassportCheck>().CountAsync(p => p.CompetitionId == k, ct)),
            ("equipment checks", await db.Set<EquipmentAcknowledgement>().CountAsync(e => e.CompetitionId == k, ct)),
            ("team profile links", await db.Set<EventTeamProfileLink>().CountAsync(l => l.CompetitionId == k, ct)),
            ("calendar versions", await db.CalendarHeatVersions.CountAsync(v => teams.Contains(v.TeamId), ct)),
            ("event settings", await db.Set<EventCommerceSettings>().CountAsync(x => x.CompetitionId == k, ct)
                + await db.Set<CompetitionEntrySettings>().CountAsync(x => x.CompetitionId == k, ct)
                + await db.Set<CompetitionDeclarationLock>().CountAsync(x => x.CompetitionId == k, ct)
                + await db.StreamOverlays.CountAsync(x => x.CompetitionId == k, ct)),
        ];
    }

    /// <summary>Which database this is: the provider with host and database name, or the SQLite file. Never credentials.</summary>
    internal static string DatabaseLabel(AppDbContext db)
    {
        var connection = db.Database.GetDbConnection().ConnectionString;
        if (db.Database.IsNpgsql())
        {
            var postgres = new Npgsql.NpgsqlConnectionStringBuilder(connection);
            return $"PostgreSQL, host {postgres.Host ?? "(none)"}, database {postgres.Database ?? "(default)"}";
        }
        return $"SQLite, file {new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connection).DataSource}";
    }

    private sealed record TableRef(string Name, string Sql, Microsoft.EntityFrameworkCore.Metadata.IEntityType Type);

    private static List<TableRef> Tables(AppDbContext db)
        => db.Model.GetEntityTypes()
            .Where(e => !e.IsOwned() && e.GetTableName() is not null && e.GetViewName() is null)
            .GroupBy(e => (e.GetTableName()!, e.GetSchema()))
            .Select(g => new TableRef(g.Key.Item1, Quote(g.Key.Item1, g.Key.Item2), g.First()))
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToList();

    private static string Quote(string name, string? schema) => schema is null ? $"\"{name}\"" : $"\"{schema}\".\"{name}\"";

    /// <summary>Column names that hold another table's id, and that table, for tables with or without a foreign key.</summary>
    private static readonly (string Column, Type Principal)[] References =
    [
        ("CompetitionId", typeof(Competition)), ("CompetitionSectionId", typeof(CompetitionSection)), ("TeamId", typeof(Team)),
        ("SessionId", typeof(Session)), ("HeatId", typeof(Heat)), ("RaceId", typeof(Race)), ("SignupId", typeof(SectionSignup)),
        ("DeclarationFormId", typeof(DeclarationForm)), ("ClubId", typeof(Club)), ("TeamProfileId", typeof(TeamProfile)),
        ("CatalogueItemId", typeof(CatalogueItem)), ("EventOrderId", typeof(EventOrder)),
    ];

    /// <summary>For every table and id column above, how many rows point at a row that doesn't exist.</summary>
    private static async Task<Dictionary<string, long>> DanglingAsync(AppDbContext db, List<TableRef> tables, CancellationToken ct)
    {
        var counts = new Dictionary<string, long>();
        foreach (var (column, principalType) in References)
        {
            var principal = db.Model.FindEntityType(principalType)!;
            var principalTable = Quote(principal.GetTableName()!, principal.GetSchema());
            foreach (var table in tables.Where(t => t.Type.ClrType != principalType))
            {
                // Cache revisions retain tombstones for deleted competitions (and key 0 is the
                // shared detail revision). They deliberately are not references to domain rows.
                if (table.Type.ClrType == typeof(CompetitionReadRevision)) continue;
                var store = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier.Table(
                    table.Type.GetTableName()!, table.Type.GetSchema());
                if (!table.Type.GetProperties().Any(p => p.GetColumnName(store) == column)) continue;
                counts[$"{table.Name}.{column}"] = await CountAsync(db,
                    $"SELECT COUNT(*) AS \"Value\" FROM {table.Sql} WHERE \"{column}\" IS NOT NULL "
                    + $"AND \"{column}\" NOT IN (SELECT \"Id\" FROM {principalTable})", ct);
            }
        }
        return counts;
    }

    // Identifiers come from the EF model, never from input.
    private static Task<long> CountAsync(AppDbContext db, string sql, CancellationToken ct)
        => db.Database.SqlQueryRaw<long>(sql).SingleAsync(ct);
}
