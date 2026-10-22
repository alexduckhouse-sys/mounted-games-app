using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class DrawChangeConfiguration : IEntityTypeConfiguration<DrawChange>
{
    public void Configure(EntityTypeBuilder<DrawChange> b)
    {
        b.Property(x => x.RequestId).HasMaxLength(100).IsRequired();
        b.Property(x => x.Fingerprint).HasMaxLength(64).IsRequired();
        b.Property(x => x.ResultJson).IsRequired();
        b.HasIndex(x => new { x.CompetitionId, x.RequestId }).IsUnique();
        b.HasIndex(x => new { x.CompetitionId, x.SectionId });
    }
}
