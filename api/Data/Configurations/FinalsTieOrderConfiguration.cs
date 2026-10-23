using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public sealed class FinalsTieOrderConfiguration : IEntityTypeConfiguration<FinalsTieOrder>
{
    public void Configure(EntityTypeBuilder<FinalsTieOrder> e)
    {
        e.HasIndex(o => o.TeamId).IsUnique();
        e.HasIndex(o => o.CompetitionId);
        e.HasOne(o => o.Competition).WithMany().HasForeignKey(o => o.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(o => o.Team).WithMany().HasForeignKey(o => o.TeamId).OnDelete(DeleteBehavior.Cascade);
    }
}
