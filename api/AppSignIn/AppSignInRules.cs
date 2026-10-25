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
    /// <summary>The one known client: the sidecar tray app.</summary>
    public const string SidecarClient = "bfstats-sidecar";

    public static readonly IReadOnlySet<string> KnownClients = new HashSet<string>(StringComparer.Ordinal) { SidecarClient };

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

    public static bool IsValidRedirectUri(string? redirectUri)
    {
        if (redirectUri is null) return false;
        var match = RedirectUriPattern().Match(redirectUri);
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
