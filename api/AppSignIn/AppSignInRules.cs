using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace api.AppSignIn;

/// <summary>
/// The pure checks of the app sign-in (features/app-sign-in, "Rules"). The site's
/// <c>/auth/app</c> page runs the same ones (ui/src/utils/appSignIn.ts) before it shows Allow.
/// </summary>
public static partial class AppSignInRules
{
    /// <summary>The relay app, on the player's own computer.</summary>
    public const string RelayClient = "bfstats-relay";

    /// <summary>
    /// bfv.bfstats.io's pages (features/bfv-through-bfstats): a site hosted for someone else,
    /// which signs its visitors in with bfstats.io's accounts. Its tokens are short-lived and
    /// only ever a plain user's (<see cref="api.Auth.TokenService.CreateAppAccessToken"/>).
    /// </summary>
    public const string BfvSiteClient = "bfv-site";

    /// <summary>bfv-site's one address on the web: the only one it is sent back to, but for
    /// a bfv page served from the visitor's own computer while it is being worked on.</summary>
    public const string BfvSiteRedirectUri = "https://bfv.bfstats.io/auth/callback";

    public static readonly IReadOnlySet<string> KnownClients =
        new HashSet<string>(StringComparer.Ordinal) { RelayClient, BfvSiteClient };

    public const int MaxDeviceLength = 64;
    public const string UnnamedDevice = "Unnamed device";
    public const int MaxStateLength = 256;
    public const string ChallengeMethod = "S256";

    /// <summary>
    /// <c>http://127.0.0.1:&lt;port&gt;/callback</c> or <c>http://localhost:&lt;port&gt;/callback</c>,
    /// exactly: lower-case scheme and host, no userinfo, a port without a leading zero, the
    /// one path, no query or fragment. The port range is checked after the match.
    /// </summary>
    [GeneratedRegex(@"\Ahttp://(?:127\.0\.0\.1|localhost):(?<port>[1-9][0-9]{3,4})/callback\z", RegexOptions.CultureInvariant)]
    private static partial Regex RedirectUriPattern();

    /// <summary>A bfv page on the visitor's own computer: <c>http://localhost:&lt;port&gt;/auth/callback</c>.</summary>
    [GeneratedRegex(@"\Ahttp://(?:127\.0\.0\.1|localhost):(?<port>[1-9][0-9]{3,4})/auth/callback\z", RegexOptions.CultureInvariant)]
    private static partial Regex LocalSiteRedirectUriPattern();

    /// <summary>base64url(SHA-256(...)) without padding is always 43 characters.</summary>
    [GeneratedRegex(@"\A[A-Za-z0-9_-]{43}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ChallengePattern();

    /// <summary>RFC 7636: 43-128 unreserved characters.</summary>
    [GeneratedRegex(@"\A[A-Za-z0-9._~-]{43,128}\z", RegexOptions.CultureInvariant)]
    private static partial Regex VerifierPattern();

    /// <summary>The state rides back in a query string: unreserved characters only.</summary>
    [GeneratedRegex(@"\A[A-Za-z0-9._~-]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex StatePattern();

    public static bool IsKnownClient(string? client) => client is not null && KnownClients.Contains(client);

    /// <summary>The relay's rule: its loopback listener.</summary>
    public static bool IsValidRedirectUri(string? redirectUri) => Loopback(RedirectUriPattern(), redirectUri);

    /// <summary>Where <paramref name="client"/> may be sent back to: the relay's loopback
    /// listener, or bfv.bfstats.io's callback (or a local bfv page's), exactly.</summary>
    public static bool IsValidRedirectUri(string? client, string? redirectUri) => client switch
    {
        RelayClient => IsValidRedirectUri(redirectUri),
        BfvSiteClient => string.Equals(redirectUri, BfvSiteRedirectUri, StringComparison.Ordinal)
            || Loopback(LocalSiteRedirectUriPattern(), redirectUri),
        _ => false,
    };

    /// <summary>What a refused redirect URI is told, for <paramref name="client"/>.</summary>
    public static string RedirectRule(string? client) => client == BfvSiteClient
        ? $"redirectUri must be {BfvSiteRedirectUri} or http://localhost:<port>/auth/callback"
        : "redirectUri must be http://127.0.0.1:<port>/callback or http://localhost:<port>/callback";

    private static bool Loopback(Regex pattern, string? redirectUri)
    {
        if (redirectUri is null) return false;
        var match = pattern.Match(redirectUri);
        if (!match.Success) return false;
        var port = int.Parse(match.Groups["port"].Value, CultureInfo.InvariantCulture);
        return port is >= 1024 and <= 65535;
    }

    public static bool IsValidState(string? state) =>
        state is { Length: > 0 and <= MaxStateLength } && StatePattern().IsMatch(state);

    public static bool IsValidChallenge(string? challenge) => challenge is not null && ChallengePattern().IsMatch(challenge);

    public static bool IsValidVerifier(string? verifier) => verifier is not null && VerifierPattern().IsMatch(verifier);

    /// <summary>The device name as shown: control characters dropped, whitespace collapsed, cut to 64.</summary>
    public static string NormalizeDevice(string? device)
    {
        if (string.IsNullOrWhiteSpace(device)) return UnnamedDevice;
        var builder = new StringBuilder(device.Length);
        var lastWasSpace = false;
        foreach (var c in device.Trim())
        {
            if (char.IsControl(c) || char.GetUnicodeCategory(c) is UnicodeCategory.Format) continue;
            var space = char.IsWhiteSpace(c);
            if (space && lastWasSpace) continue;
            builder.Append(space ? ' ' : c);
            lastWasSpace = space;
        }
        var text = builder.ToString().Trim();
        if (text.Length == 0) return UnnamedDevice;
        if (text.Length <= MaxDeviceLength) return text;
        // Do not cut a surrogate pair in half.
        var cut = MaxDeviceLength;
        if (char.IsHighSurrogate(text[cut - 1])) cut--;
        return text[..cut].TrimEnd();
    }

    /// <summary>base64url(SHA-256(ASCII verifier)), the S256 challenge.</summary>
    public static string ChallengeFor(string verifier) =>
        Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    /// <summary>Whether <paramref name="verifier"/> answers <paramref name="challenge"/>, in fixed time.</summary>
    public static bool VerifierMatches(string verifier, string challenge) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(ChallengeFor(verifier)),
            Encoding.ASCII.GetBytes(challenge));

    /// <summary>A new one-time code: 32 random bytes, base64url.</summary>
    public static string NewCode() => Base64Url(RandomNumberGenerator.GetBytes(32));

    /// <summary>The stored form of a code. The code is 256 random bits, so a plain hash is enough.</summary>
    public static string HashCode(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
