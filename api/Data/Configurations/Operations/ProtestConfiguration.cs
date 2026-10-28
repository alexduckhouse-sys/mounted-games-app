using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class ProtestConfiguration : IEntityTypeConfiguration<Protest>
{
    public void Configure(EntityTypeBuilder<Protest> b)
    {
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
        b.Property(x => x.Decision).HasMaxLength(1000);
        b.Property(x => x.RaisedByName).HasMaxLength(120);
        b.Property(x => x.ConcernsTeamIdsJson).HasMaxLength(2000).IsRequired();
        b.Property(x => x.RequestId).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.CompetitionId, x.Status });
        b.HasIndex(x => new { x.CompetitionId, x.RequestId }).IsUnique();
        b.HasIndex(x => x.HeatId);
        b.HasIndex(x => x.RaceId);
        b.HasIndex(x => x.RaisedByTeamId);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Heat).WithMany().HasForeignKey(x => x.HeatId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Race).WithMany().HasForeignKey(x => x.RaceId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.RaisedByTeam).WithMany().HasForeignKey(x => x.RaisedByTeamId).OnDelete(DeleteBehavior.SetNull);
    }
}
