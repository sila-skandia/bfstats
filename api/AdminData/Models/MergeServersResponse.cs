namespace api.AdminData.Models;

public record MergeServersResponse(
    string PrimaryGuid,
    IReadOnlyList<string> DuplicateGuids,
    int AffectedPlayers,
    int AffectedPeriods,
    int RepointedSessions,
    int RepointedRounds,
    int RepointedAchievements,
    int RepointedOnlineCounts,
    int DeletedAggregateRows
);
