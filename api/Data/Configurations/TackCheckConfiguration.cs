using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public sealed class TackCheckSectionConfiguration : IEntityTypeConfiguration<TackCheckSection>
{
    public void Configure(EntityTypeBuilder<TackCheckSection> e)
    {
        e.ToTable("TackCheckSections");
        e.HasIndex(x => x.CompetitionSectionId).IsUnique();
        e.HasIndex(x => x.CompetitionId);
        e.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(x => x.Section).WithMany().HasForeignKey(x => x.CompetitionSectionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class TackCheckSectorConfiguration : IEntityTypeConfiguration<TackCheckSector>
{
    public void Configure(EntityTypeBuilder<TackCheckSector> e)
    {
        e.ToTable("TackCheckSectors");
        e.Property(x => x.Name).HasMaxLength(60).IsRequired();
        e.HasIndex(x => x.TackCheckSectionId);
        e.HasOne(x => x.TackCheckSection).WithMany(x => x.Sectors).HasForeignKey(x => x.TackCheckSectionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class TackCheckMarkConfiguration : IEntityTypeConfiguration<TackCheckMark>
{
    public void Configure(EntityTypeBuilder<TackCheckMark> e)
    {
        e.ToTable("TackCheckMarks");
        e.Property(x => x.RecordedByUserId).HasMaxLength(450);
        e.HasIndex(x => new { x.TackCheckSectorId, x.TeamId }).IsUnique();
        e.HasIndex(x => x.TeamId);
        e.HasOne(x => x.Sector).WithMany(x => x.Marks).HasForeignKey(x => x.TackCheckSectorId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(x => x.Team).WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class PassportCheckConfiguration : IEntityTypeConfiguration<PassportCheck>
{
    public void Configure(EntityTypeBuilder<PassportCheck> e)
    {
        e.ToTable("PassportChecks");
        e.Property(x => x.PonyName).HasMaxLength(100).IsRequired();
        e.Property(x => x.PonyKey).HasMaxLength(100).IsRequired();
        e.Property(x => x.CheckedByUserId).HasMaxLength(450);
        e.Property(x => x.CheckedByName).HasMaxLength(200);
        e.HasIndex(x => new { x.TeamId, x.PonyKey }).IsUnique();
        e.HasIndex(x => x.CompetitionId);
        e.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(x => x.Team).WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
    }
}
