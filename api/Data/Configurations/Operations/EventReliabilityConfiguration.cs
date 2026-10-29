using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;
namespace MountedGames.Api.Data.Configurations.Operations;

public class HeatCallConfiguration : IEntityTypeConfiguration<HeatCall>
{
    public void Configure(EntityTypeBuilder<HeatCall> b)
    {
        b.HasKey(x => x.HeatId);
        b.HasOne(x => x.Heat).WithMany().HasForeignKey(x => x.HeatId).OnDelete(DeleteBehavior.Cascade);
    }
}
public class SubstitutionRequestConfiguration : IEntityTypeConfiguration<SubstitutionRequest>
{
    public void Configure(EntityTypeBuilder<SubstitutionRequest> b)
    {
        b.Property(x => x.Reason).HasMaxLength(500);
        b.Property(x => x.ReplacementRiderName).HasMaxLength(200);
        b.Property(x => x.ReplacementHorseName).HasMaxLength(200);
        b.Property(x => x.DeclarationFingerprint).HasMaxLength(64);
        b.Property(x => x.Status).HasMaxLength(20);
        b.HasIndex(x => new { x.CompetitionId, x.Status });
        b.HasOne(x => x.DeclarationForm).WithMany().HasForeignKey(x => x.DeclarationFormId).OnDelete(DeleteBehavior.Cascade);
    }
}
