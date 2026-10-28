using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class EntriesDigestRunConfiguration : IEntityTypeConfiguration<EntriesDigestRun>
{
    public void Configure(EntityTypeBuilder<EntriesDigestRun> b)
    {
        b.Property(x => x.RunDate).HasMaxLength(10).IsRequired();
        // The claim: whoever inserts the day's row first sends the day's email.
        b.HasIndex(x => x.RunDate).IsUnique();
    }
}

public class EntriesDigestCompetitionConfiguration : IEntityTypeConfiguration<EntriesDigestCompetition>
{
    public void Configure(EntityTypeBuilder<EntriesDigestCompetition> b)
    {
        b.HasKey(x => x.CompetitionId);
        b.Property(x => x.CompetitionId).ValueGeneratedNever();
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Location).HasMaxLength(500);
        b.HasIndex(x => x.RunId);
        b.HasOne(x => x.Run).WithMany(x => x.CompetitionRows).HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class EntriesDigestRecipientConfiguration : IEntityTypeConfiguration<EntriesDigestRecipient>
{
    public void Configure(EntityTypeBuilder<EntriesDigestRecipient> b)
    {
        b.HasIndex(x => new { x.RunId, x.OptInId }).IsUnique();
        b.HasIndex(x => new { x.RunId, x.Status });
        b.HasOne(x => x.Run).WithMany(x => x.Recipients).HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
    }
}
