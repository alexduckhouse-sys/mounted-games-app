using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations.Sponsors;

public class SponsorConfiguration : IEntityTypeConfiguration<Sponsor>
{
    public void Configure(EntityTypeBuilder<Sponsor> b)
    {
        b.Property(x => x.Name).HasMaxLength(80).IsRequired();
        b.Property(x => x.LinkUrl).HasMaxLength(300);
        b.Property(x => x.LogoContentType).HasMaxLength(30);
        b.HasIndex(x => x.CompetitionId);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class SponsorExposureConfiguration : IEntityTypeConfiguration<SponsorExposure>
{
    public void Configure(EntityTypeBuilder<SponsorExposure> b)
    {
        b.HasKey(x => new { x.SponsorId, x.Day, x.Placement });
        b.HasOne(x => x.Sponsor).WithMany().HasForeignKey(x => x.SponsorId).OnDelete(DeleteBehavior.Cascade);
    }
}
