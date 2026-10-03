namespace api.Auth.Models;

/// <summary>Forgotten-password request. Answered with 200 regardless of whether the pair matched.</summary>
public class ForgotPasswordRequest
{
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
}