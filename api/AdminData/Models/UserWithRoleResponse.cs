using NodaTime;

namespace api.AdminData.Models;

/// <param name="JoinedAt">When the account was created.</param>
/// <param name="LastLoggedInAt">Last explicit sign-in (password or Discord). Null when never recorded.</param>
/// <param name="LastActiveAt">
/// Last time the account started or resumed a session: the later of the last
/// sign-in and the last refresh-token rotation. A signed-in browser rotates its
/// token silently, so this moves even when the user never types a password.
/// </param>
public record UserWithRoleResponse(
    int UserId,
    string Email,
    string Role,
    string? Username,
    string AuthProvider,
    Instant? JoinedAt,
    Instant? LastLoggedInAt,
    Instant? LastActiveAt);
