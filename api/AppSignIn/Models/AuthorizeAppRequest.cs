namespace api.AppSignIn.Models;

/// <summary>The Allow page's request for a one-time code (features/app-sign-in, "API contract").</summary>
public record AuthorizeAppRequest(
    string? Client,
    string? Device,
    string? RedirectUri,
    string? State,
    string? CodeChallenge,
    string? CodeChallengeMethod);
