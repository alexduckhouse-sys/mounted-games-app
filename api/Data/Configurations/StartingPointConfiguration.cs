using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class StartingPointConfiguration : IEntityTypeConfiguration<StartingPoint>
{
    public void Configure(EntityTypeBuilder<StartingPoint> b)
    {
        b.Property(x => x.Name).HasMaxLength(StartingPoint.MaxNameLength).IsRequired();
        b.Property(x => x.SourceName).HasMaxLength(200);
        b.Property(x => x.OwnerUserId).IsRequired();
        b.Property(x => x.SetupJson).IsRequired();
        b.HasIndex(x => x.OwnerUserId);
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Cascade);
    }
}
