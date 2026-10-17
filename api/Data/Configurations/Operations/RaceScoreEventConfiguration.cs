using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class RaceScoreEventConfiguration : IEntityTypeConfiguration<RaceScoreEvent>
{
    public void Configure(EntityTypeBuilder<RaceScoreEvent> b)
    {
        b.Property(x => x.BeforeJson).IsRequired();
        b.Property(x => x.AfterJson).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
        b.Property(x => x.RequestId).HasMaxLength(100).IsRequired();
        b.Property(x => x.PayloadFingerprint).HasMaxLength(64).IsRequired();
        b.HasIndex(x => new { x.RaceId, x.Revision }).IsUnique();
        b.HasIndex(x => new { x.RaceId, x.RequestId }).IsUnique();
        b.HasOne(x => x.Race).WithMany().HasForeignKey(x => x.RaceId).OnDelete(DeleteBehavior.Cascade);
    }
}
