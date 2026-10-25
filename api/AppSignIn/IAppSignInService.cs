using api.AppSignIn.Models;

namespace api.AppSignIn;

/// <summary>The browser hand-off that signs an app in (features/app-sign-in).</summary>
public interface IAppSignInService
{
    /// <summary>The Allow page's click: a one-time code for the signed-in user.</summary>
    Task<AppSignInResult<AuthorizeAppResponse>> AuthorizeAsync(int userId, AuthorizeAppRequest request, CancellationToken cancellationToken = default);

    /// <summary>The app trades the code and its PKCE verifier for tokens.</summary>
    Task<AppSignInResult<AppTokenResponse>> ExchangeAsync(AppTokenRequest request, string? ipAddress, string? userAgent, CancellationToken cancellationToken = default);

    /// <summary>A new access token, and the refresh token rotated.</summary>
    Task<AppSignInResult<AppTokenResponse>> RefreshAsync(string? refreshToken, string? ipAddress, string? userAgent, CancellationToken cancellationToken = default);

    /// <summary>Signs the app out: its whole sign-in is revoked. Unknown tokens are ignored.</summary>
    Task RevokeAsync(string? refreshToken, CancellationToken cancellationToken = default);

    /// <summary>The user's live app sign-ins, most recently used first.</summary>
    Task<IReadOnlyList<AppSessionResponse>> ListSessionsAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>Revokes one of the user's app sign-ins; false when it is not theirs or not live.</summary>
    Task<bool> RevokeSessionAsync(int userId, Guid sessionId, CancellationToken cancellationToken = default);
}
