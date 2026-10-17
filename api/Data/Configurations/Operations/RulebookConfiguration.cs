using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class RulebookConfiguration : IEntityTypeConfiguration<Rulebook>
{
    public void Configure(EntityTypeBuilder<Rulebook> b)
    {
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.Edition).HasMaxLength(100).IsRequired();
        b.Property(x => x.SourceUrl).HasMaxLength(2000);
        b.Property(x => x.Text).IsRequired();
        b.HasIndex(x => new { x.CompetitionId, x.Title, x.Edition }).IsUnique();
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
    }
}
