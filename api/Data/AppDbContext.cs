using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data;

public class AppDbContext : IdentityDbContext<AppUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Club> Clubs => Set<Club>();
    public DbSet<SavedRider> SavedRiders => Set<SavedRider>();
    public DbSet<Competition> Competitions => Set<Competition>();
    public DbSet<CompetitionSection> CompetitionSections => Set<CompetitionSection>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Heat> Heats => Set<Heat>();
    public DbSet<HeatEntry> HeatEntries => Set<HeatEntry>();
    public DbSet<Race> Races => Set<Race>();
    public DbSet<Result> Results => Set<Result>();
    public DbSet<DeclarationForm> DeclarationForms => Set<DeclarationForm>();
    public DbSet<RiderEntry> RiderEntries => Set<RiderEntry>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<TrainerNote> TrainerNotes => Set<TrainerNote>();
    public DbSet<IpBlock> IpBlocks => Set<IpBlock>();
    public DbSet<RaceTemplate> RaceTemplates => Set<RaceTemplate>();
    public DbSet<StewardCall> StewardCalls => Set<StewardCall>();
    public DbSet<TeamSupporter> TeamSupporters => Set<TeamSupporter>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>(e =>
        {
            e.Property(u => u.FullName).HasMaxLength(200).IsRequired();
            e.HasOne(u => u.Club)
                .WithMany()
                .HasForeignKey(u => u.ClubId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Club>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(150).IsRequired();
            e.HasIndex(c => c.Name).IsUnique();
        });

        b.Entity<SavedRider>(e =>
        {
            e.Property(r => r.FullName).HasMaxLength(200).IsRequired();
            e.HasOne(r => r.Club)
                .WithMany(c => c.SavedRiders)
                .HasForeignKey(r => r.ClubId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Competition>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(200).IsRequired();
            e.HasOne(c => c.CreatedBy)
                .WithMany()
                .HasForeignKey(c => c.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<CompetitionSection>(e =>
        {
            e.Property(s => s.AgeGroup).HasMaxLength(50).IsRequired();
            e.Property(s => s.DisplayName).HasMaxLength(150).IsRequired();
            e.HasOne(s => s.Competition)
                .WithMany(c => c.Sections)
                .HasForeignKey(s => s.CompetitionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Team>(e =>
        {
            e.Property(t => t.Suffix).HasMaxLength(10).IsRequired();
            e.Property(t => t.DisplayName).HasMaxLength(200).IsRequired();
            e.HasOne(t => t.Competition)
                .WithMany(c => c.Teams)
                .HasForeignKey(t => t.CompetitionId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.Section)
                .WithMany(s => s.Teams)
                .HasForeignKey(t => t.CompetitionSectionId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.Club)
                .WithMany(c => c.Teams)
                .HasForeignKey(t => t.ClubId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.Trainer)
                .WithMany(u => u.CoachedTeams)
                .HasForeignKey(t => t.TrainerUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Session>(e =>
        {
            e.Property(s => s.Name).HasMaxLength(200).IsRequired();
            e.HasOne(s => s.Competition)
                .WithMany(c => c.Sessions)
                .HasForeignKey(s => s.CompetitionId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.Section)
                .WithMany(cs => cs.Sessions)
                .HasForeignKey(s => s.CompetitionSectionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Heat>(e =>
        {
            e.Property(h => h.Label).HasMaxLength(150);
            e.HasOne(h => h.Session)
                .WithMany(s => s.Heats)
                .HasForeignKey(h => h.SessionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<HeatEntry>(e =>
        {
            e.HasOne(he => he.Heat)
                .WithMany(h => h.Entries)
                .HasForeignKey(he => he.HeatId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(he => he.Team)
                .WithMany(t => t.HeatEntries)
                .HasForeignKey(he => he.TeamId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(he => new { he.HeatId, he.TeamId }).IsUnique();
        });

        b.Entity<Race>(e =>
        {
            e.Property(r => r.Name).HasMaxLength(150).IsRequired();
            e.HasOne(r => r.Heat)
                .WithMany(h => h.Races)
                .HasForeignKey(r => r.HeatId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Result>(e =>
        {
            e.HasOne(r => r.Race)
                .WithMany(rc => rc.Results)
                .HasForeignKey(r => r.RaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Team)
                .WithMany(t => t.Results)
                .HasForeignKey(r => r.TeamId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(r => new { r.RaceId, r.TeamId }).IsUnique();
        });

        b.Entity<DeclarationForm>(e =>
        {
            e.HasOne(d => d.Team)
                .WithMany(t => t.DeclarationForms)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(d => d.SubmittedBy)
                .WithMany()
                .HasForeignKey(d => d.SubmittedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<RiderEntry>(e =>
        {
            e.Property(r => r.FullName).HasMaxLength(200).IsRequired();
            e.HasOne(r => r.DeclarationForm)
                .WithMany(d => d.Riders)
                .HasForeignKey(r => r.DeclarationFormId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.SavedRider)
                .WithMany()
                .HasForeignKey(r => r.SavedRiderId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<ChatMessage>(e =>
        {
            e.Property(m => m.Body).HasMaxLength(2000).IsRequired();
            e.Property(m => m.AuthorName).HasMaxLength(150).IsRequired();
            e.HasOne(m => m.Competition)
                .WithMany(c => c.ChatMessages)
                .HasForeignKey(m => m.CompetitionId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User)
                .WithMany()
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(m => new { m.CompetitionId, m.CreatedAt });
        });

        b.Entity<TrainerNote>(e =>
        {
            e.Property(n => n.Body).IsRequired();
            e.HasOne(n => n.User)
                .WithMany(u => u.Notes)
                .HasForeignKey(n => n.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<IpBlock>(e =>
        {
            e.Property(i => i.IpAddress).HasMaxLength(64).IsRequired();
            e.HasIndex(i => i.IpAddress).IsUnique();
        });

        b.Entity<RaceTemplate>(e =>
        {
            e.Property(r => r.Name).HasMaxLength(150).IsRequired();
            e.HasIndex(r => r.Name).IsUnique();
        });

        b.Entity<StewardCall>(e =>
        {
            e.HasOne(c => c.Race)
                .WithMany()
                .HasForeignKey(c => c.RaceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Team)
                .WithMany()
                .HasForeignKey(c => c.TeamId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(c => c.RaceId);
        });

        b.Entity<TeamSupporter>(e =>
        {
            e.HasOne(s => s.Team)
                .WithMany(t => t.Supporters)
                .HasForeignKey(s => s.TeamId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(s => new { s.TeamId, s.UserId }).IsUnique();
        });
    }
}
