using NodaTime;

namespace api.AdminData.Models;

/// <summary>One server or player comment, as the admin Comments tab lists it.</summary>
/// <param name="Kind">"server" or "player".</param>
/// <param name="Target">The raw server or player name the comment was left on.</param>
/// <param name="AuthorAccount">The author's login name, or their stored email for Discord accounts.</param>
public record AdminCommentEntry(
    string Kind,
    int Id,
    string Target,
    string Content,
    string AuthorPlayerName,
    int AuthorUserId,
    string? AuthorAccount,
    Instant CreatedAt,
    Instant UpdatedAt);
