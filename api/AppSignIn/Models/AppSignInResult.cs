namespace api.AppSignIn.Models;

/// <summary>A service answer: the value, or why not (an OAuth-style error code and a message).</summary>
public record AppSignInResult<T>(AppSignInOutcome Outcome, T? Value, string? Error, string? Message);

public static class AppSignInResult
{
    public static AppSignInResult<T> Ok<T>(T value) => new(AppSignInOutcome.Ok, value, null, null);

    public static AppSignInResult<T> Fail<T>(AppSignInOutcome outcome, string error, string message) =>
        new(outcome, default, error, message);
}
