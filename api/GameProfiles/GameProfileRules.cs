using System.Buffers;
using System.Text;
using System.Text.RegularExpressions;

namespace api.GameProfiles;

/// <summary>
/// What a stored profile may hold (features/game-profiles, "Decisions"): the five
/// files the viewer reads, 64 KB of text each, ten profiles an account, and a
/// name that is a plain profile folder name.
/// </summary>
public static partial class GameProfileRules
{
    public const string GeneralOptionsFile = "GeneralOptions.con";

    /// <summary>The file keys a profile may carry, as the game lays them out under the profile folder.</summary>
    public static readonly IReadOnlyList<string> AllowedFiles =
    [
        "Controls/Common.con",
        "Controls/Infantry.con",
        "Controls/Air.con",
        "Controls/Land.con",
        GeneralOptionsFile,
    ];

    public const int MaxFileBytes = 64 * 1024;
    public const int MaxProfiles = 10;
    public const int MaxNameLength = 32;
    public const int MaxPlayerNameLength = 64;

    /// <summary>
    /// The longest name the server keeps (GameServer::createPlayer, <c>std::string(name, 0, 0x17)</c>);
    /// the sidecar's <c>SERVER_NAME_BYTES</c> (tools/bf1942-models/sidecar/player-name.mjs).
    /// </summary>
    public const int MaxSidecarNameLength = 23;

    /// <summary>Characters Windows refuses in a folder name, plus anything that could walk a path.</summary>
    private static readonly SearchValues<char> ForbiddenNameChars = SearchValues.Create("<>:\"/\\|?*");

    /// <summary>The canonical key for <paramref name="key"/> (matched case-insensitively, either slash), or null.</summary>
    public static string? CanonicalFileKey(string key)
    {
        var normalised = key.Replace('\\', '/').Trim();
        return AllowedFiles.FirstOrDefault(allowed => string.Equals(allowed, normalised, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Why <paramref name="name"/> is not a usable profile name, or null when it is.</summary>
    public static string? ValidateName(string? name)
    {
        if (string.IsNullOrEmpty(name)) return "Profile name is required";
        if (name.Length > MaxNameLength) return $"Profile name is at most {MaxNameLength} characters";
        if (name.Trim() != name) return "Profile name cannot start or end with a space";
        if (name.Any(char.IsControl) || name.AsSpan().ContainsAny(ForbiddenNameChars))
            return "Profile name contains a character a folder name cannot have";
        if (name.StartsWith('.') || name.EndsWith('.')) return "Profile name cannot start or end with a dot";
        return null;
    }

    /// <summary>Why <paramref name="playerName"/> is not a usable player name, or null when it is.</summary>
    public static string? ValidatePlayerName(string playerName)
    {
        if (playerName.Length == 0) return "Player name is required";
        if (playerName.Length > MaxPlayerNameLength) return $"Player name is at most {MaxPlayerNameLength} characters";
        if (playerName.Any(char.IsControl)) return "Player name contains a control character";
        return null;
    }

    /// <summary>
    /// The sidecar name to store for <paramref name="raw"/> (features/game-profiles, "Sidecar
    /// name"): trimmed, and null (cleared) when blank. The rule is the sidecar's own
    /// (<c>validPlayerName</c> in tools/bf1942-models/sidecar/player-name.mjs): the name rides a
    /// single-byte field and the profile file quotes it, so a quote, a control character or a
    /// character past U+00FF is refused. A name longer than the server keeps is refused here
    /// rather than cut, so the name saved is the name the scoreboard shows.
    /// </summary>
    public static (string? Name, string? Error) ValidateSidecarName(string? raw)
    {
        var name = raw?.Trim();
        if (string.IsNullOrEmpty(name)) return (null, null);
        if (name.Any(c => c == '"')) return (null, "Sidecar name cannot contain a quote");
        if (name.Any(c => c < 0x20 || c is >= '\u007f' and <= '\u009f'))
            return (null, "Sidecar name contains a control character");
        if (name.Any(c => c > '\u00ff'))
            return (null, "Sidecar name can only use Western European (Latin-1) letters");
        if (name.Length > MaxSidecarNameLength)
            return (null, $"Sidecar name is at most {MaxSidecarNameLength} characters");
        return (name, null);
    }

    /// <summary>
    /// Checks and canonicalises the files of an upload. Returns the files keyed by
    /// <see cref="AllowedFiles"/>, or the reason they are refused.
    /// </summary>
    public static (Dictionary<string, string>? Files, string? Error) ValidateFiles(IReadOnlyDictionary<string, string?>? files)
    {
        if (files is null) return (null, "files is required");
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, text) in files)
        {
            var canonical = CanonicalFileKey(key);
            if (canonical is null)
                return (null, $"'{key}' is not a profile file; allowed: {string.Join(", ", AllowedFiles)}");
            if (text is null) return (null, $"'{key}' has no text");
            if (Encoding.UTF8.GetByteCount(text) > MaxFileBytes)
                return (null, $"'{key}' is larger than {MaxFileBytes / 1024} KB");
            if (!result.TryAdd(canonical, text)) return (null, $"'{key}' is given twice");
        }
        return (result, null);
    }

    /// <summary>The name in <c>game.setPlayerName "..."</c> (the game writes it once; the last one wins), or null.</summary>
    public static string? ReadPlayerName(string? generalOptions)
    {
        if (string.IsNullOrEmpty(generalOptions)) return null;
        string? name = null;
        foreach (Match match in PlayerNamePattern().Matches(generalOptions))
        {
            var value = (match.Groups["quoted"].Success ? match.Groups["quoted"].Value : match.Groups["bare"].Value).Trim();
            if (value.Length > 0) name = value;
        }
        return name;
    }

    [GeneratedRegex("""^[ \t]*game\.setPlayerName[ \t]+(?:"(?<quoted>[^"\r\n]*)"|(?<bare>[^\s"]+))""",
        RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex PlayerNamePattern();
}
