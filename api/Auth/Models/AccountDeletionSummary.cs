namespace api.Auth.Models;

/// <summary>
/// What an account erasure actually removed. Returned to the caller so the UI can
/// show a concrete receipt rather than a bare "done", and logged (without the
/// email) so we can evidence that a request was honoured.
/// </summary>
public sealed record AccountDeletionSummary(
    int AliasesRemoved,
    int FavouriteServersRemoved,
    int BuddiesRemoved,
    int SessionsRevoked,
    int CommentsRemoved,
    int TeamRegistrationsUnlinked,
    int TournamentsAnonymised,
    int TournamentPostsAnonymised);
