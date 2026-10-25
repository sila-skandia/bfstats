using NodaTime;

namespace api.AppSignIn.Models;

/// <summary>
/// One live app sign-in in the Signed-in apps list. <see cref="Id"/> is the sign-in's
/// family id, stable across rotations; <see cref="LastUsedAt"/> is its latest refresh.
/// </summary>
public record AppSessionResponse(
    Guid Id,
    string Client,
    string Device,
    Instant CreatedAt,
    Instant LastUsedAt,
    Instant ExpiresAt);
