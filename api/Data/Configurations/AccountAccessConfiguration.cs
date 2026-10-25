using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data.Configurations;

public class AccountIpConfiguration : IEntityTypeConfiguration<AccountIp>
{
    public void Configure(EntityTypeBuilder<AccountIp> b)
    {
        b.Property(x => x.UserId).IsRequired();
        b.Property(x => x.IpHash).HasMaxLength(AccountIp.MaxHashLength).IsRequired();
        b.HasIndex(x => new { x.UserId, x.IpHash }).IsUnique();
        b.HasIndex(x => x.IpHash);
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class AccountInviteConfiguration : IEntityTypeConfiguration<AccountInvite>
{
    public void Configure(EntityTypeBuilder<AccountInvite> b)
    {
        b.Property(x => x.Email).HasMaxLength(254).IsRequired();
        b.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => x.Email);
    }
}
