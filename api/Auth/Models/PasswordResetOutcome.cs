namespace api.Auth.Models;

public enum PasswordResetOutcome
{
    Reset,
    /// <summary>Unknown, spent, superseded or expired: the page asks for a new link.</summary>
    InvalidLink,
    WeakPassword,
}
