using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class CustomEmailConfiguration : IEntityTypeConfiguration<CustomEmail>
{
    public void Configure(EntityTypeBuilder<CustomEmail> b)
    {
        b.Property(x => x.Subject).HasMaxLength(CustomEmail.MaxSubjectLength).IsRequired();
        b.Property(x => x.BlocksJson).IsRequired();
        b.Property(x => x.HtmlBody).IsRequired();
        b.Property(x => x.TextBody).IsRequired();
        b.HasIndex(x => x.CreatedAt);
    }
}

public class CustomEmailRecipientConfiguration : IEntityTypeConfiguration<CustomEmailRecipient>
{
    public void Configure(EntityTypeBuilder<CustomEmailRecipient> b)
    {
        b.Property(x => x.Address).HasMaxLength(254).IsRequired();
        b.HasIndex(x => new { x.CustomEmailId, x.Status });
        b.HasOne(x => x.CustomEmail).WithMany(x => x.Recipients).HasForeignKey(x => x.CustomEmailId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class CustomEmailImageConfiguration : IEntityTypeConfiguration<CustomEmailImage>
{
    public void Configure(EntityTypeBuilder<CustomEmailImage> b)
    {
        b.Property(x => x.ContentType).HasMaxLength(40).IsRequired();
        b.Property(x => x.Bytes).IsRequired();
        b.HasIndex(x => x.UsedByEmailId);
    }
}
