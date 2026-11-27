namespace api.Auth;

/// <summary>
/// The site an account was made on (features/bfv-through-bfstats): bfstats.io, or
/// bfv.bfstats.io, whose visitors sign up through bfstats.io's own pages on their way to its
/// Allow page. Recorded once, when the account is made, so bfv's users can be found and one
/// day managed; it grants nothing. Accounts made before it was kept have none, which is bfstats.
/// </summary>
public static class SignUpSites
{
    public const string Bfstats = "bfstats";
    public const string Bfv = "bfv";

    public const int MaxLength = 16;

    /// <summary>The site a sign-up names: bfv when it says so, else bfstats. The browser says
    /// it, so it is a note, never a permission.</summary>
    public static string From(string? via) => string.Equals(via?.Trim(), Bfv, StringComparison.OrdinalIgnoreCase) ? Bfv : Bfstats;
}
