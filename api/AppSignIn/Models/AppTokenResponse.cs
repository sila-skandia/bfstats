using NodaTime;

namespace api.AppSignIn.Models;

/// <summary>What token and refresh answer: a normal access token and the app's rotating refresh token.</summary>
public record AppTokenResponse(
    string AccessToken,
    Instant ExpiresAt,
    string RefreshToken,
    Instant RefreshExpiresAt,
    AppTokenUser User);
