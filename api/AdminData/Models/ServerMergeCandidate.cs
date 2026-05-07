namespace api.AdminData.Models;

public record ServerMergeCandidate(
    string Game,
    string Ip,
    int Port,
    string Name,
    int TotalSessions,
    long TotalPlaytimeMinutes,
    DateTime? FirstSeen,
    DateTime? LastSeen,
    IReadOnlyList<ServerMergeCandidateGuid> Guids
);
