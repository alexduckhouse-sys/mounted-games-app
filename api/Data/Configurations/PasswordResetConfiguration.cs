using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class PasswordResetTokenConfiguration : IEntityTypeConfiguration<PasswordResetToken>
{
    public void Configure(EntityTypeBuilder<PasswordResetToken> b)
    {
        b.Property(x => x.UserId).IsRequired();
        b.Property(x => x.TokenHash).HasMaxLength(PasswordResetToken.TokenHashLength).IsRequired();
        b.Property(x => x.RequestedIpHash).HasMaxLength(AccountIp.MaxHashLength);
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => new { x.UserId, x.CreatedAt });
        b.HasIndex(x => x.CreatedAt);
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
