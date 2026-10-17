using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Data.Configurations.Seasons;

public sealed class TeamProfileConfiguration : IEntityTypeConfiguration<TeamProfile>
{
    public void Configure(EntityTypeBuilder<TeamProfile> b)
    {
        b.Property(x => x.OwnerUserId).HasMaxLength(450).IsRequired();
        b.Property(x => x.Suffix).HasMaxLength(10).IsRequired();
        b.Property(x => x.DisplayName).HasMaxLength(200).IsRequired();
        b.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Club).WithMany().HasForeignKey(x => x.ClubId).OnDelete(DeleteBehavior.Restrict);
        // Similar names are deliberately allowed: identity is explicit, never inferred from text.
        b.HasIndex(x => x.OwnerUserId);
    }
}

public sealed class EventTeamProfileLinkConfiguration : IEntityTypeConfiguration<EventTeamProfileLink>
{
    public void Configure(EntityTypeBuilder<EventTeamProfileLink> b)
    {
        b.Property(x => x.LinkedByUserId).HasMaxLength(450).IsRequired();
        b.HasOne(x => x.TeamProfile).WithMany(x => x.EventTeams).HasForeignKey(x => x.TeamProfileId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Team).WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.LinkedBy).WithMany().HasForeignKey(x => x.LinkedByUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => x.TeamId).IsUnique();
        b.HasIndex(x => new { x.CompetitionId, x.TeamProfileId }).IsUnique();
    }
}
