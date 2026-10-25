namespace api.AppSignIn.Models;

/// <summary>An app's refresh token, in the body: the app sends no cookies. Used by refresh and revoke.</summary>
public record AppRefreshRequest(string? RefreshToken);
