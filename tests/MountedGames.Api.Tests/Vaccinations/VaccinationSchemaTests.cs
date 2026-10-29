using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Vaccinations;
namespace MountedGames.Api.Tests.Vaccinations;

public class VaccinationSchemaTests
{
    [Fact]
    public async Task ExistingSqliteUpgradePreservesLegacyNotesAndSeedsImmutableSourceEditions()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE Competitions (Id INTEGER PRIMARY KEY); INSERT INTO Competitions VALUES (1); CREATE TABLE PassportChecks (Id INTEGER PRIMARY KEY, OfficialNotes TEXT); INSERT INTO PassportChecks VALUES (1, 'Fake legacy note');");
        await VaccinationFeature.EnsureSqliteAsync(db); await VaccinationFeature.EnsureSqliteAsync(db);
        var policies = await db.Set<VaccinationPolicyVersion>().AsNoTracking().ToListAsync(); Assert.Equal(6, policies.Count);
        Assert.Single(policies, p => p.Automatic); Assert.Equal(new DateOnly(2026, 10, 29), policies.Single(p => p.Automatic).VerifiedOn);
        using var command = connection.CreateCommand(); command.CommandText = "SELECT OfficialNotes FROM PassportChecks WHERE Id = 1";
        Assert.Equal("Fake legacy note", await command.ExecuteScalarAsync());
        var horse = new VaccinationHorse { Id = Guid.NewGuid(), CompetitionId = 1, CreatedByUserId = "fake-owner" }; db.Add(horse);
        var link = new VaccinationDeclarationHorse { CompetitionId = 1, HorseId = horse.Id, DeclarationFormId = 100, RiderEntryId = 100, PonyNameSnapshot = "Fake Pony" }; db.Add(link); await db.SaveChangesAsync();
        db.Add(new VaccinationEvidence { CompetitionId = 1, DeclarationHorseId = link.Id, Revision = 1, RecordedByUserId = "fake-owner", Notes = "Fake private note", LastOtherVaccinationOn = new(2026, 1, 1) }); await db.SaveChangesAsync();
        Assert.Single(await db.Set<VaccinationEvidence>().ToListAsync());
        var export = await VaccinationPrivacy.ExportForUserAsync(db, "fake-owner"); Assert.Contains("Fake private note", System.Text.Json.JsonSerializer.Serialize(export));
        await VaccinationPrivacy.AnonymiseAccountAsync(db, "fake-owner"); db.ChangeTracker.Clear();
        var evidence = await db.Set<VaccinationEvidence>().SingleAsync(); Assert.Null(evidence.RecordedByUserId); Assert.Null(evidence.Notes);
        await VaccinationPrivacy.DeleteCompetitionAsync(db, 1); Assert.Empty(await db.Set<VaccinationHorse>().ToListAsync()); Assert.Empty(await db.Set<VaccinationEvidence>().ToListAsync());
        Assert.Equal("Fake legacy note", await command.ExecuteScalarAsync());
    }
}
