using NodaTime;
using System.Collections.Generic;

namespace api.Wrapped.Models;

public record PlayerWrappedResponseDto(
    string PlayerName,
    string ServerGuid, // "global" for cross-server
    string ServerName, // "Global (All Servers)" or server name
    int Year,
    PlayerYearInNumbersDto YearInNumbers,
    PlayerTrendDto Trend,
    PlayerFavouriteMapDto FavouriteMap,
    PlayerMedalsDto Medals,
    List<PlayerBestMomentDto> BestMoments,
    List<PlayerTeammateDto> Squad,
    List<PlayerServerRankingDto> ServerRankings,
    PlayerRelationsDto Relations
);

public record PlayerYearInNumbersDto(
    int RoundsPlayed,
    int TotalKills,
    int TotalDeaths,
    double HoursInCombat,
    double KdRatio,
    int ServerRank,
    int KillsRank,
    int PlacementsRank,
    double RoundsPercentile,
    double KillsPercentile,
    double PlayTimePercentile,
    double KdPercentile
);

public record PlayerServerRankingDto(
    string ServerGuid,
    string ServerName,
    int Rank,
    int TotalScore,
    int TotalRankedPlayers,
    double AveragePing
);

public record PlayerTrendDto(
    List<double> MonthlyKDs,       // 12 values
    List<double> MonthlyKillRates, // 12 values
    List<PlayerMapRankDto> TopMaps  // Top 3 maps
);

public record PlayerMapRankDto(
    string MetricName,
    string MapName,
    string MetricValue
);

public record PlayerFavouriteMapDto(
    string MapName,
    int Rounds,
    double WinRate,
    List<PlayerMapProgressDto> TopMaps5,
    string HomeServerName,
    string HomeServerLocation,
    double PlayerKPM,
    double GlobalKPM,
    double KpmMultiplier,
    int TotalKills,
    int TotalDeaths,
    double KdRatio,
    int TotalScore,
    double PlayTimeMinutes
);

public record PlayerMapProgressDto(
    string MapName,
    int Rounds,
    double PlayTimePercentage,
    string BarColor
);

public record PlayerMedalsDto(
    int KillStreaks25,
    int PodiumFinishes,
    string EliteWarriorBadgeName,
    string EliteWarriorTier,
    int BestStreak,
    string LifetimeMilestoneText,
    List<PlayerAchievementTypeCountDto> AchievementTypes,
    List<PlayerAchievementCountDto> AchievementsBreakdown
);

public record PlayerAchievementTypeCountDto(
    string Type,
    int Count
);

public record PlayerAchievementCountDto(
    string AchievementId,
    string Name,
    string Type,
    string Tier,
    int Count
);

public record PlayerBestMomentDto(
    string Type,
    int Value,
    string MapName,
    Instant Date,
    int EstimatedDurationMinutes,
    int ServerStreakRank
);

public record PlayerTeammateDto(
    string Name,
    int SharedRounds
);

public record PlayerRelationsDto(
    string? LuckyCharmName,
    int? LuckyCharmWins,
    string? ArchNemesisName,
    int? ArchNemesisLosses,
    string? TwoFaceName,
    int? TwoFaceWins,
    int? TwoFaceLosses
);
