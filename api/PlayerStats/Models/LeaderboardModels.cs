namespace api.PlayerStats.Models;

/// <summary>
/// DTO representing a player entry in the global raw leaderboard.
/// </summary>
public class LeaderboardPlayerDto
{
    public int Rank { get; set; }
    public required string Name { get; set; }
    public string Tag { get; set; } = "";
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public double Kd { get; set; }
    public int Score { get; set; }
    public double Kpm { get; set; }
    public int PlayMin { get; set; }
    public int Rounds { get; set; }
    public string? LastSeen { get; set; }
    public string? FavServer { get; set; }
    public string? FavServerGuid { get; set; }
    public string? FavServerCountry { get; set; }
    public string? FavServerFlag { get; set; }
    public string? FavMap { get; set; }
    public bool IsActive { get; set; }
    public string? CurrentServer { get; set; }
    public List<LeaderboardPlayerServerDto>? Servers { get; set; }
}

/// <summary>
/// DTO representing a player's stats on a specific server in grouped views.
/// </summary>
public class LeaderboardPlayerServerDto
{
    public required string Guid { get; set; }
    public required string Name { get; set; }
    public string ShortName { get; set; } = "";
    public string Country { get; set; } = "";
    public string Flag { get; set; } = "";
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public double Kd { get; set; }
    public int Score { get; set; }
    public double Kpm { get; set; }
    public int PlayMin { get; set; }
    public int Rounds { get; set; }
}

/// <summary>
/// DTO representing an active server entry for server chips/slicers on the leaderboard.
/// </summary>
public class LeaderboardServerDto
{
    public required string Guid { get; set; }
    public required string Name { get; set; }
    public string ShortName { get; set; } = "";
    public string Country { get; set; } = "";
    public string Flag { get; set; } = "";
    public int PlayerCount { get; set; }
    public double AvgPlayers { get; set; }
    public bool IsPopulated { get; set; }
}

/// <summary>
/// DTO representing an active map entry for map slicers on the leaderboard.
/// </summary>
public class LeaderboardMapDto
{
    public required string Name { get; set; }
    public required string DisplayName { get; set; }
    public int PlayerCount { get; set; }
}

/// <summary>
/// Full payload returned by the global leaderboard raw data dump endpoint.
/// </summary>
public class GlobalLeaderboardResponse
{
    public int Days { get; set; }
    public int MinRounds { get; set; }
    public int MinPlay { get; set; }
    public string? Server { get; set; }
    public string? Exclude { get; set; }
    public bool PopulatedOnly { get; set; }
    public string? Map { get; set; }
    public string? SearchQuery { get; set; }
    public string? GroupBy { get; set; }
    public string SortBy { get; set; } = "score";
    public string SortDir { get; set; } = "desc";
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
    public int TotalPages { get; set; } = 1;
    public int TotalPlayers { get; set; }
    public List<LeaderboardPlayerDto> Players { get; set; } = [];
    public List<LeaderboardServerDto> Servers { get; set; } = [];
    public List<LeaderboardMapDto> Maps { get; set; } = [];
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
}
