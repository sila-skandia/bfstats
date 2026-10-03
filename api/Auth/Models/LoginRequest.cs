namespace api.Auth.Models;

public class LoginRequest
{
    public string? DiscordCode { get; set; }
    public string? RedirectUri { get; set; }
    public bool? DevBypass { get; set; }

    /// <summary>Username for password sign-in. Present together with Password selects that branch.</summary>
    public string? Username { get; set; }
    public string? Password { get; set; }
}