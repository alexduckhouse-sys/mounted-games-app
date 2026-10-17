using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Data.Configurations.Seasons;

public sealed class SeasonConfiguration : IEntityTypeConfiguration<Season>
{
    public void Configure(EntityTypeBuilder<Season> b)
    {
        b.Property(x => x.OwnerUserId).HasMaxLength(450).IsRequired();
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.AgeGroup).HasMaxLength(50).IsRequired();
        b.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.Year, x.Format, x.AgeGroup });
    }
}

public sealed class SeasonPlacePointsConfiguration : IEntityTypeConfiguration<SeasonPlacePoints>
{
    public void Configure(EntityTypeBuilder<SeasonPlacePoints> b)
    {
        b.HasOne(x => x.Season).WithMany(x => x.PlacePoints).HasForeignKey(x => x.SeasonId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(x => new { x.SeasonId, x.Place }).IsUnique();
    }
}

public sealed class SeasonRoundConfiguration : IEntityTypeConfiguration<SeasonRound>
{
    public void Configure(EntityTypeBuilder<SeasonRound> b)
    {
        b.HasOne(x => x.Season).WithMany(x => x.Rounds).HasForeignKey(x => x.SeasonId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.CompetitionSection).WithMany().HasForeignKey(x => x.CompetitionSectionId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.SeasonId, x.CompetitionSectionId }).IsUnique();
        b.HasIndex(x => new { x.SeasonId, x.OrderIndex }).IsUnique();
    }
}

public sealed class SeasonRoundPublicationConfiguration : IEntityTypeConfiguration<SeasonRoundPublication>
{
    public void Configure(EntityTypeBuilder<SeasonRoundPublication> b)
    {
        b.Property(x => x.SourceFingerprint).HasMaxLength(64).IsRequired();
        b.Property(x => x.PublishedByUserId).HasMaxLength(450).IsRequired();
        b.HasOne(x => x.SeasonRound).WithMany(x => x.Publications).HasForeignKey(x => x.SeasonRoundId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.PublishedBy).WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.SeasonRoundId, x.Version }).IsUnique();
    }
}

public sealed class SeasonRoundResultConfiguration : IEntityTypeConfiguration<SeasonRoundResult>
{
    public void Configure(EntityTypeBuilder<SeasonRoundResult> b)
    {
        b.Property(x => x.TeamName).HasMaxLength(200).IsRequired();
        b.Property(x => x.ClubName).HasMaxLength(150).IsRequired();
        b.HasOne(x => x.SeasonRoundPublication).WithMany(x => x.Results).HasForeignKey(x => x.SeasonRoundPublicationId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.TeamProfile).WithMany().HasForeignKey(x => x.TeamProfileId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.SeasonRoundPublicationId, x.TeamProfileId }).IsUnique();
    }
}
