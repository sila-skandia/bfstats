namespace api.AppSignIn.Models;

/// <summary>How an app sign-in call ended; the controller maps each to a status code.</summary>
public enum AppSignInOutcome
{
    Ok,

    /// <summary>400 <c>invalid_request</c>: malformed or refused (unknown client, bad redirect URI, ...).</summary>
    InvalidRequest,

    /// <summary>400 <c>invalid_grant</c>: a wrong verifier, another redirect URI, a used or expired code.</summary>
    InvalidGrant,

    /// <summary>401: the refresh token is unknown, revoked, expired or not an app's.</summary>
    Unauthorized,

    NotFound,

    /// <summary>503: the hourly SQLite writer is holding the lock; try again shortly.</summary>
    Busy,
}
