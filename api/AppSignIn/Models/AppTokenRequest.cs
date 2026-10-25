namespace api.AppSignIn.Models;

/// <summary>The app's code exchange: the code, the PKCE verifier and the same redirect URI.</summary>
public record AppTokenRequest(string? Code, string? CodeVerifier, string? RedirectUri);
