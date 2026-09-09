namespace api.Auth.Models;

/// <summary>
/// Erasure is irreversible, so the client has to say so explicitly rather than
/// have a bare DELETE be enough. <see cref="Confirm"/> must be the literal
/// <c>DELETE</c>, which the UI collects by making the user type it.
/// </summary>
public class DeleteAccountRequest
{
    public string? Confirm { get; set; }

    public const string RequiredPhrase = "DELETE";
}
