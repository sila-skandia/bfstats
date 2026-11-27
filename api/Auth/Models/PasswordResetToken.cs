using api.PlayerTracking;
using NodaTime;

namespace api.Auth.Models;

/// <summary>
/// A one-time password reset link (features/password-reset): single use, thirty
/// minutes, bound to one password account. The token itself is only in the email;
/// the row keeps its SHA-256.
/// </summary>
public class PasswordResetToken
{
    public int Id { get; set; }

    /// <summary>Upper-case hex SHA-256 of the token.</summary>
    public string TokenHash { get; set; } = "";

    public int UserId { get; set; }

    public Instant CreatedAt { get; set; }

    public Instant ExpiresAt { get; set; }

    /// <summary>Set when the link is spent, or when a newer link or a reset supersedes it.</summary>
    public Instant? UsedAt { get; set; }

    public User User { get; set; } = null!;
}
