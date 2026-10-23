using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Data;

public class AppDbContext : IdentityDbContext<AppUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Club> Clubs => Set<Club>();
    public DbSet<ClubPayoutAccount> ClubPayoutAccounts => Set<ClubPayoutAccount>();
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
    public DbSet<LiveStream> LiveStreams => Set<LiveStream>();
    public DbSet<StreamOverlay> StreamOverlays => Set<StreamOverlay>();
    public DbSet<Sponsor> Sponsors => Set<Sponsor>();
    public DbSet<SponsorExposure> SponsorExposures => Set<SponsorExposure>();
    public DbSet<OverlayLook> OverlayLooks => Set<OverlayLook>();
    public DbSet<CompetitionCollaborator> CompetitionCollaborators => Set<CompetitionCollaborator>();
    public DbSet<ScorerLink> ScorerLinks => Set<ScorerLink>();
    public DbSet<TrainerNote> TrainerNotes => Set<TrainerNote>();
    public DbSet<IpBlock> IpBlocks => Set<IpBlock>();
    public DbSet<RaceTemplate> RaceTemplates => Set<RaceTemplate>();
    public DbSet<TeamSupporter> TeamSupporters => Set<TeamSupporter>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<SectionSignup> SectionSignups => Set<SectionSignup>();
    public DbSet<EmailOptIn> EmailOptIns => Set<EmailOptIn>();
    public DbSet<ShopPost> ShopPosts => Set<ShopPost>();
    public DbSet<ShopComment> ShopComments => Set<ShopComment>();
    public DbSet<ShopReport> ShopReports => Set<ShopReport>();
    public DbSet<CalendarHeatVersion> CalendarHeatVersions => Set<CalendarHeatVersion>();
    public DbSet<SpecialAward> SpecialAwards => Set<SpecialAward>();
    public DbSet<FinalsTieOrder> FinalsTieOrders => Set<FinalsTieOrder>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        b.Entity<CompetitionCollaborator>(e =>
        {
            e.HasIndex(c => new { c.CompetitionId, c.UserId }).IsUnique();
            e.HasIndex(c => c.UserId);
            e.Property(c => c.UserId).IsRequired();
            e.Property(c => c.AddedByUserId).IsRequired();
            e.HasOne(c => c.Competition).WithMany().HasForeignKey(c => c.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<OverlayLook>(e =>
        {
            e.Property(l => l.OwnerUserId).IsRequired();
            e.Property(l => l.Name).HasMaxLength(60).IsRequired();
            e.Property(l => l.LookJson).HasMaxLength(4000).IsRequired();
            e.HasIndex(l => l.OwnerUserId);
        });
        b.Entity<StreamOverlay>(e =>
        {
            e.HasKey(o => o.CompetitionId);
            e.HasOne(o => o.Competition).WithOne().HasForeignKey<StreamOverlay>(o => o.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.Property(o => o.BannerText).HasMaxLength(140);
            e.Property(o => o.BannerArenas).HasMaxLength(1000).IsRequired();
            e.Property(o => o.LookJson).HasMaxLength(4000).IsRequired();
        });
        b.Entity<LiveStream>(e =>
        {
            e.Property(s => s.ArenaName).HasMaxLength(80).IsRequired();
            e.Property(s => s.AngleName).HasMaxLength(60).IsRequired();
            e.Property(s => s.Caption).HasMaxLength(80);
            e.Property(s => s.SfuSessionId).HasMaxLength(100);
            e.Property(s => s.PendingSfuSessionId).HasMaxLength(100);
            e.Property(s => s.StartedByUserId).IsRequired();
            e.HasIndex(s => new { s.CompetitionId, s.Status });
            e.HasOne(s => s.Competition).WithMany().HasForeignKey(s => s.CompetitionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        if (Database.IsNpgsql())
        {
            // Existing API timestamps without an offset are interpreted as UTC.
            // Browsers already submit scheduled times with an explicit UTC offset.
            foreach (var property in b.Model.GetEntityTypes().SelectMany(e => e.GetProperties()))
            {
                if ((Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType) == typeof(DateTime))
                    property.SetValueConverter(new UtcDateTimeConverter());
            }
            b.Entity<SavedRider>().Property(r => r.DateOfBirth)
                .HasColumnType("timestamp without time zone").HasConversion(new CalendarDateTimeConverter());
            b.Entity<RiderEntry>().Property(r => r.DateOfBirth)
                .HasColumnType("timestamp without time zone").HasConversion(new CalendarDateTimeConverter());
        }

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

        b.Entity<ClubPayoutAccount>(e =>
        {
            e.HasIndex(a => a.ClubId).IsUnique();
            e.Property(a => a.Currency).HasMaxLength(3).IsRequired();
            e.Property(a => a.LegalName).HasMaxLength(150);
            e.Property(a => a.TradingName).HasMaxLength(150);
            e.Property(a => a.AddressLine1).HasMaxLength(150);
            e.Property(a => a.AddressLine2).HasMaxLength(150);
            e.Property(a => a.City).HasMaxLength(100);
            e.Property(a => a.Postcode).HasMaxLength(12);
            e.Property(a => a.ContactEmail).HasMaxLength(200);
            e.Property(a => a.ContactPhone).HasMaxLength(30);
            e.Property(a => a.RegistrationNumber).HasMaxLength(20);
            e.Property(a => a.VatNumber).HasMaxLength(20);
            e.Property(a => a.PersonFullName).HasMaxLength(150);
            e.Property(a => a.StatementDescriptor).HasMaxLength(22);
            e.Property(a => a.BankAccountHolder).HasMaxLength(150);
            e.Property(a => a.BankName).HasMaxLength(100);
            e.Property(a => a.SortCode).HasMaxLength(8);
            e.Property(a => a.AccountLast4).HasMaxLength(4);
            e.Property(a => a.IbanCountry).HasMaxLength(2);
            e.Property(a => a.IbanLast4).HasMaxLength(4);
            e.HasOne(a => a.Club).WithMany().HasForeignKey(a => a.ClubId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SavedRider>(e =>
        {
            e.Property(r => r.FullName).HasMaxLength(200).IsRequired();
            e.Property(r => r.PonyHeightHands).HasPrecision(4, 1);
            e.HasOne(r => r.Club)
                .WithMany(c => c.SavedRiders)
                .HasForeignKey(r => r.ClubId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Competition>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(200).IsRequired();
            e.Property(c => c.Icon).HasMaxLength(24).HasDefaultValue("flag").IsRequired();
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
            e.Property(t => t.CalendarFeedTokenHash).HasMaxLength(64);
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
            e.Property(r => r.RefereeNote).HasMaxLength(500);
        });

        b.Entity<DeclarationForm>(e =>
        {
            e.Property(d => d.TrainerName).HasMaxLength(200);
            e.HasOne(d => d.Team)
                .WithMany(t => t.DeclarationForms)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(d => d.SubmittedBy)
                .WithMany()
                .HasForeignKey(d => d.SubmittedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // Rider privacy choices: both off unless the rider (or their trainer) ticks them.
        foreach (var privacy in new[] { typeof(SavedRider), typeof(RiderEntry), typeof(SectionSignup) })
        {
            b.Entity(privacy).Property(nameof(RiderEntry.UseInitialOnly)).HasDefaultValue(false);
            b.Entity(privacy).Property(nameof(RiderEntry.NoFilming)).HasDefaultValue(false);
        }

        b.Entity<RiderEntry>(e =>
        {
            e.Property(r => r.FullName).HasMaxLength(200).IsRequired();
            e.Property(r => r.PonyHeightHands).HasPrecision(4, 1);
            e.Property(r => r.WeightKg).HasPrecision(5, 1);
            e.Property(r => r.AgeGroup).HasMaxLength(30);
            e.Property(r => r.PonyPassportNumber).HasMaxLength(60);
            e.Property(r => r.MembershipNumber).HasMaxLength(60);
            e.Property(r => r.EmergencyContactName).HasMaxLength(120);
            e.Property(r => r.EmergencyContactPhone).HasMaxLength(40);
            e.Property(r => r.MedicalNotes).HasMaxLength(1000);
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

        b.Entity<CalendarHeatVersion>(e =>
        {
            e.Property(v => v.Fingerprint).HasMaxLength(64).IsRequired();
            e.HasOne<Heat>().WithMany().HasForeignKey(v => v.HeatId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Team>().WithMany().HasForeignKey(v => v.TeamId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(v => new { v.HeatId, v.TeamId }).IsUnique();
            e.HasIndex(v => v.TeamId);
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

        b.Entity<PushSubscription>(e =>
        {
            e.HasOne(p => p.User)
                .WithMany()
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(p => p.Endpoint).IsUnique();
        });

        b.Entity<SectionSignup>(e =>
        {
            e.Property(s => s.FullName).HasMaxLength(200).IsRequired();
            e.HasOne(s => s.Section)
                .WithMany(cs => cs.Signups)
                .HasForeignKey(s => s.CompetitionSectionId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(s => new { s.CompetitionSectionId, s.UserId });
            e.Property(s => s.ContactEmail).HasMaxLength(254);
            e.Property(s => s.ClientRequestId).HasMaxLength(64);
            e.Property(s => s.ConfirmationEmailStatus).HasDefaultValue(EmailDeliveryStatus.NotRequested);
            // A retried submit must not create a second entry (NULLs never collide).
            e.HasIndex(s => new { s.CompetitionSectionId, s.UserId, s.ClientRequestId }).IsUnique();
        });

        b.Entity<EmailOptIn>(e =>
        {
            e.Property(o => o.Email).HasMaxLength(254).IsRequired();
            e.Property(o => o.WordingVersion).HasMaxLength(40).IsRequired();
            e.Property(o => o.Source).HasMaxLength(40).IsRequired();
            e.Property(o => o.UnsubscribeTokenHash).HasMaxLength(64).IsRequired();
            e.HasIndex(o => o.UnsubscribeTokenHash).IsUnique();
            e.HasIndex(o => o.Email);
        });

        b.Entity<ShopPost>(e =>
        {
            e.Property(p => p.Title).HasMaxLength(200).IsRequired();
            e.Property(p => p.Body).HasMaxLength(4000).IsRequired();
            e.Property(p => p.AuthorName).HasMaxLength(150).IsRequired();
            e.HasOne(p => p.Author)
                .WithMany()
                .HasForeignKey(p => p.AuthorUserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(p => new { p.IsDeleted, p.CreatedAt });
        });

        b.Entity<ShopComment>(e =>
        {
            e.Property(c => c.Body).HasMaxLength(2000).IsRequired();
            e.Property(c => c.AuthorName).HasMaxLength(150).IsRequired();
            e.HasOne(c => c.Post)
                .WithMany(p => p.Comments)
                .HasForeignKey(c => c.PostId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Author)
                .WithMany()
                .HasForeignKey(c => c.AuthorUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<ShopReport>(e =>
        {
            e.HasOne(r => r.Post)
                .WithMany(p => p.Reports)
                .HasForeignKey(r => r.PostId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Reporter)
                .WithMany()
                .HasForeignKey(r => r.ReporterUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });
    }
}
