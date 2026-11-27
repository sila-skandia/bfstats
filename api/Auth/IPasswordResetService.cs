using api.Auth.Models;

namespace api.Auth;

public interface IPasswordResetService
{
    /// <summary>
    /// A forgotten-password request. Emails a one-time link when the username and
    /// email match a password account; asks the owner on Discord when the account
    /// exists but cannot get one. Says nothing back either way.
    /// </summary>
    Task RequestAsync(string? username, string? email, CancellationToken cancellationToken = default);

    /// <summary>Spends a link: sets the new password and signs out every session the account holds.</summary>
    Task<PasswordResetOutcome> ResetAsync(string? token, string? newPassword, CancellationToken cancellationToken = default);
}
