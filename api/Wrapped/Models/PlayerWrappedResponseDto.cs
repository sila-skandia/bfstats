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
    PlayerBestMomentDto BestMoment,
    List<PlayerTeammateDto> Squad
);

public record PlayerYearInNumbersDto(
    int RoundsPlayed,
    int TotalKills,
    int TotalDeaths,
    double HoursInCombat,
    double KdRatio,
    int ServerRank
);

public record PlayerTrendDto(
    List<double> MonthlyKDs,       // 12 values
    List<double> MonthlyKillRates, // 12 values
    List<PlayerMapRankDto> TopMaps  // Top 3 maps
);

public record PlayerMapRankDto(
    int Rank,
    string MapName,
    int TotalRounds
);

public record PlayerFavouriteMapDto(
    string MapName,
    int Rounds,
    double WinRate,
    List<PlayerMapProgressDto> TopMaps5,
    string HomeServerName,
    string HomeServerLocation
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
    int Streak,
    string MapName,
    Instant Date,
    int EstimatedDurationMinutes,
    int ServerStreakRank
);

public record PlayerTeammateDto(
    string Name,
    int SharedRounds
);
