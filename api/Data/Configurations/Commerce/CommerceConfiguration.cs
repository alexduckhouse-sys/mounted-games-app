using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Data.Configurations.Commerce;

public sealed class CatalogueItemConfiguration : IEntityTypeConfiguration<CatalogueItem>
{
    public void Configure(EntityTypeBuilder<CatalogueItem> e)
    {
        e.Property(x => x.SellerUserId).HasMaxLength(450).IsRequired();
        e.Property(x => x.Title).HasMaxLength(200).IsRequired();
        e.Property(x => x.Description).HasMaxLength(4000).IsRequired();
        e.Property(x => x.Currency).HasMaxLength(3).HasDefaultValue("GBP").IsRequired();
        e.Property(x => x.ImageUrl).HasMaxLength(2048);
        e.Property(x => x.Version).HasDefaultValue(1L).IsConcurrencyToken();
        e.HasOne(x => x.Seller).WithMany().HasForeignKey(x => x.SellerUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.SellerUserId, x.IsActive });
    }
}

public sealed class CompetitionListingConfiguration : IEntityTypeConfiguration<CompetitionListing>
{
    public void Configure(EntityTypeBuilder<CompetitionListing> e)
    {
        e.Property(x => x.SellerUserId).HasMaxLength(450).IsRequired();
        e.Property(x => x.ReviewNote).HasMaxLength(500);
        e.Property(x => x.ReviewedByUserId).HasMaxLength(450);
        e.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        e.HasOne(x => x.CatalogueItem).WithMany().HasForeignKey(x => x.CatalogueItemId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.CompetitionId, x.CatalogueItemId }).IsUnique();
        e.HasIndex(x => new { x.SellerUserId, x.Status });
    }
}

public sealed class EventCommerceSettingsConfiguration : IEntityTypeConfiguration<EventCommerceSettings>
{
    public void Configure(EntityTypeBuilder<EventCommerceSettings> e)
    {
        e.HasKey(x => x.CompetitionId);
        e.Property(x => x.UpdatedByUserId).HasMaxLength(450);
        e.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class EventOrderConfiguration : IEntityTypeConfiguration<EventOrder>
{
    public void Configure(EntityTypeBuilder<EventOrder> e)
    {
        e.Property(x => x.BuyerUserId).HasMaxLength(450).IsRequired();
        e.Property(x => x.IdempotencyKey).HasMaxLength(100).IsRequired();
        e.Property(x => x.RequestHash).HasMaxLength(64).IsRequired();
        e.Property(x => x.Currency).HasMaxLength(3).HasDefaultValue("GBP").IsRequired();
        e.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne(x => x.Buyer).WithMany().HasForeignKey(x => x.BuyerUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.BuyerUserId, x.IdempotencyKey }).IsUnique();
        e.HasIndex(x => new { x.CompetitionId, x.CreatedAt });
    }
}

public sealed class EventOrderLineConfiguration : IEntityTypeConfiguration<EventOrderLine>
{
    public void Configure(EntityTypeBuilder<EventOrderLine> e)
    {
        e.Property(x => x.SellerUserId).HasMaxLength(450).IsRequired();
        e.Property(x => x.TitleSnapshot).HasMaxLength(200).IsRequired();
        e.Property(x => x.ReservedStockQuantity).HasDefaultValue(0);
        e.HasOne(x => x.Order).WithMany(x => x.Lines).HasForeignKey(x => x.EventOrderId).OnDelete(DeleteBehavior.Cascade);
        e.HasIndex(x => new { x.SellerUserId, x.EventOrderId });
    }
}

public sealed class TestPaymentRecordConfiguration : IEntityTypeConfiguration<TestPaymentRecord>
{
    public void Configure(EntityTypeBuilder<TestPaymentRecord> e)
    {
        e.Property(x => x.OwnerUserId).HasMaxLength(450).IsRequired();
        e.Property(x => x.IdempotencyKey).HasMaxLength(100).IsRequired();
        e.Property(x => x.Currency).HasMaxLength(3).HasDefaultValue("GBP").IsRequired();
        e.Property(x => x.Provider).HasMaxLength(30).HasDefaultValue("fake").IsRequired();
        e.Property(x => x.ReceiptReference).HasMaxLength(80).IsRequired();
        e.Property(x => x.ReceiptLabel).HasMaxLength(100).IsRequired();
        e.HasOne(x => x.EventOrder).WithMany(x => x.TestPayments).HasForeignKey(x => x.EventOrderId).OnDelete(DeleteBehavior.Cascade);
        e.HasIndex(x => new { x.OwnerUserId, x.IdempotencyKey }).IsUnique();
        e.HasIndex(x => new { x.CompetitionId, x.Target, x.TargetId });
    }
}
