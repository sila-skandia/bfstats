namespace api.DiscordNotifications;

/// <summary>
/// Where forgotten-password requests the site cannot answer by email go
/// (features/password-reset). Bound from "DiscordPasswordReset"
/// (env: DiscordPasswordReset__WebhookUrl, from discord-secrets.password-reset-webhook).
/// Unset, the notice is skipped.
/// </summary>
public class DiscordPasswordResetOptions
{
    public string? WebhookUrl { get; set; }

    /// <summary>The admin page the notice links to, where Access regenerates a password.</summary>
    public string AdminUrl { get; set; } = "https://bfstats.io/v4/admin/data";
}
