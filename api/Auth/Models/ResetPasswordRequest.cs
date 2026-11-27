namespace api.Auth.Models;

/// <summary>The reset page's submission: the token from the emailed link and the new password.</summary>
public record ResetPasswordRequest(string? Token, string? NewPassword);
