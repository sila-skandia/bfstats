namespace api.Auth.Models;

/// <summary>
/// Username + password sign-up. Email is optional — when given it is stored
/// only as a keyed hash (EmailHashService) and used for nothing except
/// forgotten-password lookup. PlayerName, when given, is linked to the new
/// account's aliases during registration.
/// </summary>
public class RegisterRequest
{
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string? Email { get; set; }
    public string? PlayerName { get; set; }
}