using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class RiderSwapEventConfiguration : IEntityTypeConfiguration<RiderSwapEvent>
{
    public void Configure(EntityTypeBuilder<RiderSwapEvent> b)
    {
        b.Property(x => x.BeforeJson).IsRequired();
        b.Property(x => x.AfterJson).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(500).IsRequired();
        b.Property(x => x.RequestId).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.DeclarationFormId, x.RequestId }).IsUnique();
        b.HasIndex(x => x.CompetitionId);
        b.HasOne(x => x.DeclarationForm).WithMany().HasForeignKey(x => x.DeclarationFormId).OnDelete(DeleteBehavior.Cascade);
    }
}
