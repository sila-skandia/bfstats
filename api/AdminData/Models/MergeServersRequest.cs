namespace api.AdminData.Models;

public record MergeServersRequest(
    string PrimaryGuid,
    IReadOnlyList<string> DuplicateGuids,
    // When true, skip the Game/Ip/Port/Name identity check. Used by the manual
    // merge basket where an admin asserts that servers which changed their name
    // (and/or GUID/IP) over time are in fact the same physical server.
    bool Force = false
);
