using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class EquipmentAcknowledgementConfiguration : IEntityTypeConfiguration<EquipmentAcknowledgement>
{
    public void Configure(EntityTypeBuilder<EquipmentAcknowledgement> b)
    {
        b.Property(x => x.ItemKey).HasMaxLength(300).IsRequired();
        b.HasIndex(x => new { x.CompetitionId, x.ItemKey }).IsUnique();
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
    }
}
