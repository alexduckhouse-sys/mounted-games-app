using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public sealed class SpecialAwardConfiguration : IEntityTypeConfiguration<SpecialAward>
{
    public void Configure(EntityTypeBuilder<SpecialAward> e)
    {
        e.Property(a => a.Title).HasMaxLength(100).IsRequired();
        e.Property(a => a.Recipient).HasMaxLength(200).IsRequired();
        e.Property(a => a.Note).HasMaxLength(300);
        e.HasIndex(a => a.CompetitionId);
        e.HasOne(a => a.Competition).WithMany().HasForeignKey(a => a.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(a => a.Section).WithMany().HasForeignKey(a => a.CompetitionSectionId).OnDelete(DeleteBehavior.Cascade);
    }
}
