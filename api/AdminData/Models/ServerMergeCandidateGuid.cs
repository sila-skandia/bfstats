namespace api.AdminData.Models;

public record ServerMergeCandidateGuid(
    string ServerGuid,
    int SessionCount,
    long PlaytimeMinutes,
    DateTime? FirstSession,
    DateTime? LastSession,
    bool IsOnline,
    DateTime LastSeenTime
);
