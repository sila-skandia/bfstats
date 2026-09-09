using api.Auth.Models;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.Auth;

/// <summary>
/// Erasure works by tombstoning rather than row-deleting the <see cref="User"/>.
///
/// Four foreign keys onto Users are <c>DeleteBehavior.Restrict</c> — Tournament,
/// TournamentPost, TournamentMatchComment and TournamentComment all pin their
/// creator. A hard <c>DELETE FROM Users</c> would therefore throw for anyone who
/// has ever run a tournament, which is exactly the population most likely to ask.
/// Cascading instead would silently take a whole tournament (teams, matches,
/// results, other people's comments) down with one person's erasure request.
///
/// So: everything personal is hard-deleted, and the User row is left behind
/// stripped of anything that identifies a human. The remaining row is an opaque
/// integer that keeps other people's tournaments referentially intact.
/// </summary>
public class AccountService(
    PlayerTrackerDbContext context,
    ILogger<AccountService> logger) : IAccountService
{
    /// <summary>
    /// RFC 2606 reserves <c>.invalid</c>, so a tombstone address can never be
    /// routed, re-registered, or mistaken for a real inbox. Keyed by user id to
    /// satisfy the unique index on Users.Email.
    /// </summary>
    internal static string TombstoneEmail(int userId) => $"deleted-user-{userId}@deleted.invalid";

    internal static bool IsTombstoned(User user) => user.Email == TombstoneEmail(user.Id);

    public async Task<AccountExport?> ExportAsync(int userId, CancellationToken cancellationToken = default)
    {
        var user = await context.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null || IsTombstoned(user)) return null;

        var aliases = await context.UserPlayerNames.AsNoTracking()
            .Where(upn => upn.UserId == userId)
            .OrderBy(upn => upn.CreatedAt)
            .Select(upn => new AccountExportAlias(upn.PlayerName, upn.CreatedAt))
            .ToListAsync(cancellationToken);

        var favourites = await context.UserFavoriteServers.AsNoTracking()
            .Where(ufs => ufs.UserId == userId)
            .OrderBy(ufs => ufs.CreatedAt)
            .Select(ufs => new AccountExportFavouriteServer(
                ufs.ServerGuid,
                context.Servers.Where(s => s.Guid == ufs.ServerGuid).Select(s => s.Name).FirstOrDefault(),
                ufs.CreatedAt))
            .ToListAsync(cancellationToken);

        var buddies = await context.UserBuddies.AsNoTracking()
            .Where(ub => ub.UserId == userId)
            .OrderBy(ub => ub.CreatedAt)
            .Select(ub => new AccountExportBuddy(ub.BuddyPlayerName, ub.CreatedAt))
            .ToListAsync(cancellationToken);

        // TokenHash is deliberately absent — it is a credential, and handing it
        // back in an export would be a way to exfiltrate a live session.
        var sessions = await context.RefreshTokens.AsNoTracking()
            .Where(rt => rt.UserId == userId)
            .OrderByDescending(rt => rt.CreatedAt)
            .Select(rt => new AccountExportSession(
                rt.CreatedAt, rt.ExpiresAt, rt.RevokedAt, rt.IpAddress, rt.UserAgent))
            .ToListAsync(cancellationToken);

        var playerComments = await context.PlayerComments.AsNoTracking()
            .Where(c => c.AuthorUserId == userId)
            .Select(c => new AccountExportComment(
                "player", c.PlayerName, c.AuthorPlayerName, c.Content,
                c.CreatedAt.ToDateTimeUtc(), c.UpdatedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        var serverComments = await context.ServerComments.AsNoTracking()
            .Where(c => c.AuthorUserId == userId)
            .Select(c => new AccountExportComment(
                "server", c.ServerName, c.AuthorPlayerName, c.Content,
                c.CreatedAt.ToDateTimeUtc(), c.UpdatedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        var tournamentComments = await context.TournamentComments.AsNoTracking()
            .Where(c => c.AuthorUserId == userId)
            .Select(c => new AccountExportComment(
                "tournament", c.Tournament.Name, c.AuthorPlayerName, c.Content,
                c.CreatedAt.ToDateTimeUtc(), c.UpdatedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        var matchComments = await context.TournamentMatchComments.AsNoTracking()
            .Where(c => c.CreatedByUserId == userId)
            .Select(c => new AccountExportComment(
                "tournament-match", c.Match.Tournament.Name, "", c.Content,
                c.CreatedAt.ToDateTimeUtc(), c.UpdatedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        var tournaments = await context.Tournaments.AsNoTracking()
            .Where(t => t.CreatedByUserId == userId)
            .Select(t => new AccountExportTournament(t.Id, t.Name, t.CreatedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        var memberships = await context.TournamentTeamPlayers.AsNoTracking()
            .Where(ttp => ttp.UserId == userId)
            .Select(ttp => new AccountExportTeamMembership(
                ttp.PlayerName, ttp.TournamentTeam.Name, ttp.IsTeamLeader, ttp.JoinedAt.ToDateTimeUtc()))
            .ToListAsync(cancellationToken);

        return new AccountExport(
            ExportedAtUtc: DateTime.UtcNow.ToString("O"),
            Profile: new AccountExportProfile(
                user.Id, user.Email, user.Role, user.CreatedAt, user.LastLoggedIn, user.IsActive),
            LinkedPlayerNames: aliases,
            FavouriteServers: favourites,
            Buddies: buddies,
            Sessions: sessions,
            Comments: [.. playerComments, .. serverComments, .. tournamentComments, .. matchComments],
            Tournaments: tournaments,
            TournamentTeamMemberships: memberships);
    }

    public async Task<AccountDeletionSummary?> DeleteAsync(int userId, CancellationToken cancellationToken = default)
    {
        var user = await context.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null || IsTombstoned(user)) return null;

        // One transaction: a half-erased account is worse than a failed request,
        // because the user is told it worked and the leftovers are invisible.
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var aliases = await context.UserPlayerNames.Where(x => x.UserId == userId).ToListAsync(cancellationToken);
        var favourites = await context.UserFavoriteServers.Where(x => x.UserId == userId).ToListAsync(cancellationToken);
        var buddies = await context.UserBuddies.Where(x => x.UserId == userId).ToListAsync(cancellationToken);
        var sessions = await context.RefreshTokens.Where(x => x.UserId == userId).ToListAsync(cancellationToken);

        context.UserPlayerNames.RemoveRange(aliases);
        context.UserFavoriteServers.RemoveRange(favourites);
        context.UserBuddies.RemoveRange(buddies);
        context.RefreshTokens.RemoveRange(sessions);

        // Comments are the user's own words and carry the in-game alias they
        // posted under, so they go with the account rather than being reassigned
        // to an "[deleted]" author.
        var playerComments = await context.PlayerComments.Where(c => c.AuthorUserId == userId).ToListAsync(cancellationToken);
        var serverComments = await context.ServerComments.Where(c => c.AuthorUserId == userId).ToListAsync(cancellationToken);
        var tournamentComments = await context.TournamentComments.Where(c => c.AuthorUserId == userId).ToListAsync(cancellationToken);
        var matchComments = await context.TournamentMatchComments.Where(c => c.CreatedByUserId == userId).ToListAsync(cancellationToken);

        // TournamentComment.ParentCommentId is Restrict. Threading is unused
        // today, but an orphaned reply would make the whole erasure throw, so
        // detach any replies before their parent goes.
        var doomedCommentIds = tournamentComments.Select(c => c.Id).ToHashSet();
        if (doomedCommentIds.Count > 0)
        {
            var replies = await context.TournamentComments
                .Where(c => c.ParentCommentId != null
                            && doomedCommentIds.Contains(c.ParentCommentId.Value)
                            && c.AuthorUserId != userId)
                .ToListAsync(cancellationToken);
            foreach (var reply in replies) reply.ParentCommentId = null;
        }

        context.PlayerComments.RemoveRange(playerComments);
        context.ServerComments.RemoveRange(serverComments);
        context.TournamentComments.RemoveRange(tournamentComments);
        context.TournamentMatchComments.RemoveRange(matchComments);

        // Tournament rosters are public competition records. The roster line
        // keeps the in-game name that played; only the account link is severed.
        var memberships = await context.TournamentTeamPlayers.Where(ttp => ttp.UserId == userId).ToListAsync(cancellationToken);
        foreach (var membership in memberships) membership.UserId = null;

        var ledTeams = await context.TournamentTeams.Where(tt => tt.LeaderUserId == userId).ToListAsync(cancellationToken);
        foreach (var team in ledTeams) team.LeaderUserId = null;

        // Tournament and TournamentPost denormalise the creator's email. The row
        // has to survive (Restrict, and other people depend on the tournament),
        // but the address must not.
        var tombstone = TombstoneEmail(userId);
        var tournaments = await context.Tournaments.Where(t => t.CreatedByUserId == userId).ToListAsync(cancellationToken);
        foreach (var tournament in tournaments) tournament.CreatedByUserEmail = tombstone;

        var posts = await context.TournamentPosts.Where(p => p.CreatedByUserId == userId).ToListAsync(cancellationToken);
        foreach (var post in posts) post.CreatedByUserEmail = tombstone;

        user.Email = tombstone;
        user.Role = null;
        user.IsActive = false;

        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var summary = new AccountDeletionSummary(
            AliasesRemoved: aliases.Count,
            FavouriteServersRemoved: favourites.Count,
            BuddiesRemoved: buddies.Count,
            SessionsRevoked: sessions.Count,
            CommentsRemoved: playerComments.Count + serverComments.Count + tournamentComments.Count + matchComments.Count,
            TeamRegistrationsUnlinked: memberships.Count + ledTeams.Count,
            TournamentsAnonymised: tournaments.Count,
            TournamentPostsAnonymised: posts.Count);

        // Deliberately no email in this log line — logging the address of someone
        // who just asked to be forgotten would defeat the request.
        logger.LogInformation(
            "Erased account {UserId}: {Aliases} aliases, {Favourites} favourites, {Buddies} buddies, "
            + "{Sessions} sessions, {Comments} comments, {Memberships} team links, {Tournaments} tournaments anonymised",
            userId, summary.AliasesRemoved, summary.FavouriteServersRemoved, summary.BuddiesRemoved,
            summary.SessionsRevoked, summary.CommentsRemoved, summary.TeamRegistrationsUnlinked,
            summary.TournamentsAnonymised);

        return summary;
    }
}
