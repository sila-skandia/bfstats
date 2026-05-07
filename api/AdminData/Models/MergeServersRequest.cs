namespace api.AdminData.Models;

public record MergeServersRequest(
    string PrimaryGuid,
    IReadOnlyList<string> DuplicateGuids
);
