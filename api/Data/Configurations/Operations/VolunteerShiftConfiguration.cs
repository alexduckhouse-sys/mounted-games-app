using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Data.Configurations.Operations;

public class VolunteerShiftConfiguration : IEntityTypeConfiguration<VolunteerShift>
{
    public void Configure(EntityTypeBuilder<VolunteerShift> b)
    {
        b.ToTable("VolunteerShift");
        b.Property(x => x.Role).HasMaxLength(80).IsRequired();
        b.Property(x => x.DutyCategory).HasMaxLength(40).HasDefaultValue("Custom").IsRequired();
        b.Property(x => x.AssignedClubName).HasMaxLength(150);
        b.Property(x => x.AttendanceStatus).HasMaxLength(20).HasDefaultValue("Assigned").IsRequired();
        b.Property(x => x.CheckedInByName).HasMaxLength(160);
        b.Property(x => x.CheckedInByUserId).HasMaxLength(120);
        b.Property(x => x.ArenaName).HasMaxLength(80);
        b.Property(x => x.StartTimeLabel).HasMaxLength(80);
        b.Property(x => x.Notes).HasMaxLength(500);
        b.HasIndex(x => x.CompetitionId);
        b.HasIndex(x => x.SessionId);
        b.HasIndex(x => x.AssignedTeamId);
        b.HasOne(x => x.Competition).WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Session).WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.SetNull);
        b.HasOne(x => x.AssignedTeam).WithMany().HasForeignKey(x => x.AssignedTeamId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class VolunteerClaimConfiguration : IEntityTypeConfiguration<VolunteerClaim>
{
    public void Configure(EntityTypeBuilder<VolunteerClaim> b)
    {
        b.ToTable("VolunteerClaim");
        b.Property(x => x.UserId).IsRequired();
        b.Property(x => x.VolunteerName).HasMaxLength(160).IsRequired();
        b.Property(x => x.ClubName).HasMaxLength(150);
        b.Property(x => x.ContactPhone).HasMaxLength(40);
        b.HasIndex(x => x.ShiftId);
        b.HasIndex(x => new { x.ShiftId, x.UserId });
        b.HasOne(x => x.Shift).WithMany(s => s.Claims).HasForeignKey(x => x.ShiftId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
