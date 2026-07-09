using NodaTime;
using System.Collections.Generic;

namespace api.Wrapped.Models;

public record ServerWrappedResponseDto(
    string ServerGuid,
    string ServerName,
    int Year,
    YearInNumbersDto YearInNumbers,
    BusiestHoursDto BusiestHours,
    RotationDto Rotation,
    HonoursDto Honours,
    DecorationsDto Decorations,
    DishonoursDto Dishonours,
    List<ClosestBattleDto> ClosestBattles
);

public record YearInNumbersDto(
    int RoundsFought,
    int UniqueSoldiers,
    double HoursInCombat,
    int PeakPopulation,
    Instant PeakTimestamp,
    int TotalDecorations
);

public record BusiestHoursDto(
    List<HeatmapCellDto> HeatmapCells, // 168 cells: 7 days x 24 hours
    List<double> HourlyAverages        // 24 values
);

public record HeatmapCellDto(
    int DayOfWeek,
    int HourOfDay,
    double AvgPlayers
);

public record RotationDto(
    List<MapRotationDto> Maps,
    string MostPlayedMapName,
    int MostPlayedRounds,
    double MostPlayedPercentage
);

public record MapTopPlacementDto(
    string PlayerName,
    int FirstPlaceCount
);

public record MapRotationDto(
    string MapName,
    int RoundsPlayed,
    int PlayTimeMinutes,
    double PlayTimePercentage,
    List<MapTopPlacementDto> TopPlacements
);

public record HonoursDto(
    List<PlayerKDRatioDto> TopKDRatios,
    List<PlayerKillRateDto> TopKillRates,
    VolumeBoardsDto VolumeBoards
);

public record PlayerKDRatioDto(
    string PlayerName,
    int Rounds,
    int Kills,
    int Deaths,
    double KDRatio,
    int Rank
);

public record PlayerKillRateDto(
    string PlayerName,
    int Rounds,
    int Kills,
    int PlayTimeMinutes,
    double KillRate,
    int Rank
);

public record VolumeBoardsDto(
    PlayerVolumeDto TopScore,
    PlayerVolumeDto TopKills,
    PlayerVolumeDto TopHours
);

public record PlayerVolumeDto(
    string PlayerName,
    double Value
);

public record PrestigiousMilestoneDto(
    string AchievementId,
    string PlayerName,
    string AchievementName,
    string Description
);

public record DecorationsDto(
    PlayerVolumeDto MostStreaksOf25,
    StreakOfTheYearDto? StreakOfTheYear, // Nullable if no streaks recorded
    PlayerVolumeDto MostPodiumFinishes,
    int MilestonesCrossed,
    PrestigiousMilestoneDto? PrestigiousMilestone,
    PlayerVolumeDto? EliteWarriorGold,
    PlayerVolumeDto? EliteWarriorLegend,
    PlayerVolumeDto? MostLegendAchievements
);

public record StreakOfTheYearDto(
    string PlayerName,
    int Streak,
    string MapName,
    Instant Date
);

public record DishonoursDto(
    PlayerVolumeDto CannonFodder, // Most deaths
    PlayerLossRateDto? HardLuck,   // Nullable if no player qualified
    PlayerAvgPingDto? DialUp,       // Nullable if no player qualified
    PlayerKDRatioDto? StatTourist  // Nullable if no player qualified
);

public record PlayerLossRateDto(
    string PlayerName,
    int Rounds,
    int Losses,
    double LossRate
);

public record PlayerAvgPingDto(
    string PlayerName,
    int Sessions,
    double AvgPing
);

public record ClosestBattleDto(
    string MapName,
    Instant Date,
    int PlayersCount,
    int TicketsMargin,
    int DurationMinutes
);
