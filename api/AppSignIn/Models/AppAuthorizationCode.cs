using api.PlayerTracking;
using NodaTime;

namespace api.AppSignIn.Models;

/// <summary>
/// A one-time code the Allow page minted for an app (features/app-sign-in): single use,
/// two minutes, bound to the user, the client, the redirect URI and the PKCE challenge.
/// The code itself is never stored, only its SHA-256.
/// </summary>
public class AppAuthorizationCode
{
    public int Id { get; set; }

    /// <summary>Upper-case hex SHA-256 of the code.</summary>
    public string CodeHash { get; set; } = "";

    public int UserId { get; set; }

    public string Client { get; set; } = "";

    public string Device { get; set; } = "";

    public string RedirectUri { get; set; } = "";

    /// <summary>base64url(SHA-256(verifier)); only S256 is accepted.</summary>
    public string CodeChallenge { get; set; } = "";

    public Instant CreatedAt { get; set; }

    public Instant ExpiresAt { get; set; }

    /// <summary>Set by the first exchange attempt, whatever its outcome.</summary>
    public Instant? UsedAt { get; set; }

    /// <summary>The sign-in the code was exchanged for: a second exchange revokes it.</summary>
    public Guid? FamilyId { get; set; }

    public User User { get; set; } = null!;
}
