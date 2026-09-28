using System.Text.Json;
using api.Recordings.Models;

namespace api.Recordings;

/// <summary>
/// A recording's round fingerprint (features/replay-feed, "Rounds"), built as
/// <see cref="RecordingInspector"/> streams its lines past. Only what the server sends every
/// client of a round is a key, and only once play has begun:
/// <list type="bullet">
/// <item>a kill or a team kill (<c>score</c> 3 and 6) by the killer's and the victim's names
/// and the weapon's template id;</item>
/// <item>a player joining (<c>createPlayer</c>) or leaving (<c>destroyPlayer</c>) by name;</item>
/// <item>a chat-box line said to everyone, by its text (a team line reaches one side; the
/// server's own lines repeat on a timer, round after round);</item>
/// <item>an object made during play (<c>createObject</c>) by its net id and template id.</item>
/// </list>
/// Names are the pid's at the moment: a public server hands a leaver's pid to the next to
/// join. The join's database (up to <c>dbComplete</c>) and what a file begun mid-round holds
/// of it (<c>ago</c>) are the world as it stood, not events: they name players, and are never
/// keys. The level's own objects take the same net ids every time it loads, so ids made at
/// the join would match two rounds of one map.
/// </summary>
internal sealed class RoundFingerprintBuilder
{
    /// <summary>The most keys of each kind a fingerprint keeps: past it, the kind is sampled
    /// by hash. A 21-minute public round has 538 player keys and 1156 object keys.</summary>
    public const int MaxKeysPerKind = 2048;

    private const int MaxPid = 255;

    private readonly Kind players = new(RoundKey.PlayerBit);
    private readonly Kind objects = new(0);
    private readonly Dictionary<int, string> names = [];
    private double? joinAt;

    public static bool Wants(string kind, string? eventName) => kind switch
    {
        "e" => eventName is "createPlayer" or "destroyPlayer" or "score" or "createObject" or "dbComplete",
        "chat" or "roster" => true,
        _ => false,
    };

    /// <summary>One record the inspector has read whole: <paramref name="kind"/> its <c>k</c>,
    /// <paramref name="eventName"/> its <c>e</c>.</summary>
    public void Line(string kind, string? eventName, double time, ReadOnlySpan<byte> line)
    {
        if (!Wants(kind, eventName) || !double.IsFinite(time)) return;
        try
        {
            using var doc = JsonDocument.Parse(line.ToArray());
            var root = doc.RootElement;
            switch (kind)
            {
                case "e":
                    Event(eventName!, time, root);
                    break;
                case "chat":
                    Chat(time, root);
                    break;
                case "roster":
                    Roster(root);
                    break;
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            // A line the fingerprint cannot read is left out of it, not held against the file.
        }
    }

    public RoundFingerprint Build(double durationSeconds)
    {
        var keys = players.Keys.Concat(objects.Keys).OrderBy(k => k.Millis).ToList();
        var from = joinAt ?? 0;
        return new RoundFingerprint(keys, players.Sample, objects.Sample, from, Math.Max(from, durationSeconds));
    }

    private void Event(string name, double time, JsonElement root)
    {
        var held = root.TryGetProperty("ago", out _);
        switch (name)
        {
            case "dbComplete":
                // The join's database ends here: what came before it was the world as it stood.
                if (!held && joinAt is null)
                {
                    joinAt = time;
                    players.Clear();
                    objects.Clear();
                }
                break;
            case "createPlayer":
                if (Int(root, "pid") is not { } pid || String(root, "name") is not { Length: > 0 } joined) return;
                if (!held) Add(players, time, "J", joined);
                if (pid is >= 0 and <= MaxPid) names[pid] = joined;
                break;
            case "destroyPlayer":
                if (!held && Int(root, "pid") is { } left && names.TryGetValue(left, out var leaver)) Add(players, time, "L", leaver);
                break;
            case "score":
                if (held || Int(root, "kind") is not (3 or 6) || Int(root, "pid") is not { } killer || Int(root, "victim") is not { } victim) return;
                if (!names.TryGetValue(killer, out var by) || !names.TryGetValue(victim, out var of)) return;
                Add(players, time, "K", $"{Int(root, "kind")}|{by}|{of}|{Int(root, "weapon")}");
                break;
            case "createObject":
                if (held || Int(root, "netId") is not { } netId) return;
                var template = Int(root, "tid")?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? String(root, "tmpl");
                Add(objects, time, "O", $"{netId}|{template}");
                break;
        }
    }

    /// <summary>A chat-box line. The server's own (no pid, no side) repeat on its timer; the
    /// recording player's own line is on his screen before the server relays it, with no pid
    /// but his side, and says what everyone else reads.</summary>
    private void Chat(double time, JsonElement root)
    {
        if (root.TryGetProperty("ago", out _)) return;
        var pid = Int(root, "pid") ?? -1;
        var team = Int(root, "team") ?? 0;
        if (pid < 0 && team == 0) return;
        var text = String(root, "text");
        if (text.Length == 0 || TeamLine(text)) return;
        Add(players, time, "C", text);
    }

    /// <summary>A line to one side: <c>name [allies]: text</c>, whatever the mod calls its
    /// sides.</summary>
    internal static bool TeamLine(string text)
    {
        var colon = text.IndexOf(": ", StringComparison.Ordinal);
        if (colon <= 0) return false;
        var speaker = text.AsSpan(0, colon);
        return speaker.EndsWith("]") && speaker.Contains(" [", StringComparison.Ordinal);
    }

    /// <summary>Who was playing when a file begun after the join began.</summary>
    private void Roster(JsonElement root)
    {
        if (!root.TryGetProperty("p", out var rows) || rows.ValueKind != JsonValueKind.Array) return;
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() < 4) continue;
            if (row[0].ValueKind != JsonValueKind.Number || !row[0].TryGetInt32(out var pid) || pid is < 0 or > MaxPid) continue;
            if (row[3].ValueKind == JsonValueKind.String && row[3].GetString() is { Length: > 0 } name) names[pid] = name;
        }
    }

    private void Add(Kind kind, double time, string type, string what)
    {
        // Past the join's database only, and nothing it still said at the same moment.
        if (joinAt is { } join && time <= join) return;
        kind.Add(Hash(type, what), (int)Math.Round(Math.Clamp(time, 0, RecordingInspector.MaxDurationSeconds) * 1000));
    }

    /// <summary>FNV-1a over the key's text, folded to 32 bits: the same in every recording and
    /// every build.</summary>
    internal static uint Hash(string type, string what)
    {
        const ulong prime = 1099511628211;
        var hash = 14695981039346656037;
        foreach (var c in type)
        {
            hash = (hash ^ (byte)c) * prime;
            hash = (hash ^ (byte)(c >> 8)) * prime;
        }
        hash = (hash ^ '|') * prime;
        foreach (var c in what)
        {
            hash = (hash ^ (byte)c) * prime;
            hash = (hash ^ (byte)(c >> 8)) * prime;
        }
        return (uint)(hash ^ (hash >> 32));
    }

    private static int? Int(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n) ? n : null;

    private static string String(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    /// <summary>One kind of key, sampled by hash once it has more than it keeps.</summary>
    private sealed class Kind(uint flag)
    {
        public List<RoundKey> Keys { get; } = [];

        /// <summary>Keys whose low 31 bits are below this are kept.</summary>
        public uint Sample { get; private set; } = RoundFingerprint.Everything;

        public void Add(uint hash, int millis)
        {
            var key = new RoundKey(flag == 0 ? hash & ~RoundKey.PlayerBit : hash | RoundKey.PlayerBit, millis);
            if (key.Sampled >= Sample) return;
            Keys.Add(key);
            while (Keys.Count > MaxKeysPerKind && Sample > 1)
            {
                Sample >>= 1;
                Keys.RemoveAll(k => k.Sampled >= Sample);
            }
        }

        public void Clear()
        {
            Keys.Clear();
            Sample = RoundFingerprint.Everything;
        }
    }
}
