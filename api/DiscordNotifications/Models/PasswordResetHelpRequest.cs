namespace api.DiscordNotifications.Models;

/// <summary>
/// Posted to the owner's Discord channel when a forgotten-password request names
/// an account that cannot get an email: it has none, or the address typed is not
/// the one registered. Only the account, never what the requester typed.
/// </summary>
public record PasswordResetHelpRequest(int UserId, string Username, PasswordResetHelpReason Reason);

public enum PasswordResetHelpReason
{
    NoEmailOnAccount,
    EmailDidNotMatch,
}
