namespace MountedGames.Api.Entities.Seasons;

public class Season
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OwnerUserId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Year { get; set; }
    public SectionFormat Format { get; set; }
    public string AgeGroup { get; set; } = string.Empty;
    public int? BestResultsToCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public AppUser? Owner { get; set; }
    public ICollection<SeasonPlacePoints> PlacePoints { get; set; } = new List<SeasonPlacePoints>();
    public ICollection<SeasonRound> Rounds { get; set; } = new List<SeasonRound>();
}

public class SeasonPlacePoints
{
    public int Id { get; set; }
    public Guid SeasonId { get; set; }
    public int Place { get; set; }
    public int Points { get; set; }

    public Season? Season { get; set; }
}

public class SeasonRound
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeasonId { get; set; }
    public int CompetitionId { get; set; }
    public int CompetitionSectionId { get; set; }
    public int OrderIndex { get; set; }
    public bool IsIncluded { get; set; } = true;
    public double PointsMultiplier { get; set; } = 1.0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Season? Season { get; set; }
    public Competition? Competition { get; set; }
    public CompetitionSection? CompetitionSection { get; set; }
    public ICollection<SeasonRoundPublication> Publications { get; set; } = new List<SeasonRoundPublication>();
}

public class SeasonRoundPublication
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeasonRoundId { get; set; }
    public int Version { get; set; }
    public string SourceFingerprint { get; set; } = string.Empty;
    public string PublishedByUserId { get; set; } = string.Empty;
    public DateTime PublishedAt { get; set; } = DateTime.UtcNow;

    public SeasonRound? SeasonRound { get; set; }
    public AppUser? PublishedBy { get; set; }
    public ICollection<SeasonRoundResult> Results { get; set; } = new List<SeasonRoundResult>();
}

public class SeasonRoundResult
{
    public int Id { get; set; }
    public Guid SeasonRoundPublicationId { get; set; }
    public Guid TeamProfileId { get; set; }
    public int EventTeamId { get; set; }
    public string TeamName { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public int EventRank { get; set; }
    public double EventPoints { get; set; }
    public int SeasonPoints { get; set; }

    public SeasonRoundPublication? SeasonRoundPublication { get; set; }
    public TeamProfile? TeamProfile { get; set; }
}
