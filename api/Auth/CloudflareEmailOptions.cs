namespace api.Auth;

/// <summary>
/// Cloudflare Email Service (features/password-reset). The token needs the
/// "Email Sending: Edit" permission, and <see cref="From"/> must be on a domain
/// onboarded for Email Sending in the same account. No mailbox is needed: the
/// address only sends.
/// </summary>
public class CloudflareEmailOptions
{
    public const string Section = "CloudflareEmail";

    public string? AccountId { get; set; }
    public string? ApiToken { get; set; }
    public string From { get; set; } = "noreply@bfstats.io";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(AccountId) && !string.IsNullOrWhiteSpace(ApiToken);
}
