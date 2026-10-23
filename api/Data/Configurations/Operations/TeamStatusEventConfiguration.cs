using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class TeamStatusEventConfiguration : IEntityTypeConfiguration<TeamStatusEvent>
{
    public void Configure(EntityTypeBuilder<TeamStatusEvent> b)
    {
        b.Property(x => x.Reason).HasMaxLength(500).IsRequired();
        b.Property(x => x.RemovedEntriesJson).IsRequired();
        b.HasIndex(x => new { x.TeamId, x.Id });
        b.HasIndex(x => x.CompetitionId);
        b.HasOne(x => x.Team).WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
    }
}
