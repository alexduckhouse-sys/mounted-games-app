using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class ScorerLinkConfiguration : IEntityTypeConfiguration<ScorerLink>
{
    public void Configure(EntityTypeBuilder<ScorerLink> b)
    {
        b.Property(x => x.Label).HasMaxLength(ScorerLink.MaxLabelLength).IsRequired();
        b.Property(x => x.ArenaName).HasMaxLength(ScorerLink.MaxArenaLength).IsRequired();
        b.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        b.Property(x => x.CreatedByUserId).IsRequired();
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => x.CompetitionId);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
    }
}
