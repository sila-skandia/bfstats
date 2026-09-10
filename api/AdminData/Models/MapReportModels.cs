using NodaTime;

namespace api.AdminData.Models;

public record MapReportRequest(
    string? Status = "missing",
    string? Mod = null,
    string? Search = null,
    int Page = 1,
    int PageSize = 50,
    string? SortBy = "rounds",
    bool SortDesc = true,
    string? GroupBy = null
);

public record MapReportSummary(
    int TotalMaps,
    int MissingIconMaps,
    int HasIconMaps,
    int TotalMods,
    int UninstalledMods
);

public record MapReportModSummary(
    string GameId,
    bool IsInstalled,
    int TotalMaps,
    int MissingMaps,
    int HasIconMaps,
    int TotalRounds,
    int ServerCount,
    List<string> SampleServers
);

public record MapReportModGroup(
    string GameId,
    bool IsInstalled,
    int TotalMaps,
    int MissingMaps,
    int HasIconMaps,
    int TotalRounds,
    int ServerCount,
    List<string> SampleServers,
    List<MapReportItem> Maps
);

public record MapReportServerItem(
    string ServerGuid,
    string ServerName,
    string GameId,
    int Rounds,
    int TotalPlayTimeMinutes,
    Instant? LastSeen,
    bool IsOnline,
    string Ip,
    int Port
);

public record MapReportItem(
    string MapName,
    string NormalizedMapName,
    bool HasThumbnail,
    bool HasMinimap,
    bool HasDossier,
    string? ResolvedMod,
    int TotalRounds,
    int TotalPlayTimeMinutes,
    Instant? LastSeen,
    int ServerCount,
    List<MapReportServerItem> Servers
);

public record MapReportResponse(
    MapReportSummary Summary,
    List<MapReportModSummary> Mods,
    List<MapReportItem> Items,
    int TotalMatching,
    int Page,
    int PageSize,
    List<MapReportModGroup>? ModGroups = null
);
