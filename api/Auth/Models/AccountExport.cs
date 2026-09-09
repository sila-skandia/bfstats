namespace api.Auth.Models;

/// <summary>
/// Everything the account holds about a signed-in user, in a portable shape.
/// Backs the GDPR right of access / data portability that the privacy policy
/// promises. Public gameplay statistics are deliberately NOT included: they are
/// observed from public game servers and are not account data — see
/// <c>features/account-deletion-and-legal/README.md</c>.
/// </summary>
public sealed record AccountExport(
    string ExportedAtUtc,
    AccountExportProfile Profile,
    IReadOnlyList<AccountExportAlias> LinkedPlayerNames,
    IReadOnlyList<AccountExportFavouriteServer> FavouriteServers,
    IReadOnlyList<AccountExportBuddy> Buddies,
    IReadOnlyList<AccountExportSession> Sessions,
    IReadOnlyList<AccountExportComment> Comments,
    IReadOnlyList<AccountExportTournament> Tournaments,
    IReadOnlyList<AccountExportTeamMembership> TournamentTeamMemberships);

public sealed record AccountExportProfile(
    int Id,
    string Email,
    string? Role,
    DateTime CreatedAt,
    DateTime LastLoggedIn,
    bool IsActive);

public sealed record AccountExportAlias(string PlayerName, DateTime LinkedAt);

public sealed record AccountExportFavouriteServer(string ServerGuid, string? ServerName, DateTime AddedAt);

public sealed record AccountExportBuddy(string BuddyPlayerName, DateTime AddedAt);

/// <summary>
/// A sign-in session. The token hash itself is never exported — it is a
/// credential, not user data.
/// </summary>
public sealed record AccountExportSession(
    DateTime CreatedAt,
    DateTime ExpiresAt,
    DateTime? RevokedAt,
    string? IpAddress,
    string? UserAgent);

public sealed record AccountExportComment(
    string Kind,
    string Subject,
    string PostedAsPlayerName,
    string Content,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);

public sealed record AccountExportTournament(int Id, string Name, DateTime CreatedAtUtc);

public sealed record AccountExportTeamMembership(
    string PlayerName,
    string TeamName,
    bool IsTeamLeader,
    DateTime JoinedAtUtc);
