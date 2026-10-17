using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class RaceScoreStateConfiguration : IEntityTypeConfiguration<RaceScoreState>
{
    public void Configure(EntityTypeBuilder<RaceScoreState> b)
    {
        b.HasIndex(x => x.RaceId).IsUnique();
        b.Property(x => x.Revision).IsConcurrencyToken();
        b.HasOne(x => x.Race).WithMany().HasForeignKey(x => x.RaceId).OnDelete(DeleteBehavior.Cascade);
    }
}
