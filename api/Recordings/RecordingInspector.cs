using System.Buffers;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;

namespace api.Recordings;

/// <summary>
/// Reads a gzipped bf42plus recording as it streams: that it is one (its first line is the
/// recorder's header, <c>{"k":"h",...}</c>, the check the viewer makes of a dropped file),
/// how long it runs, its SHA-256, and what it says about itself — its level, game type, mod,
/// server and players. One pass, a line at a time, so a recording of any length costs a
/// 64 KB buffer and its longest line.
/// </summary>
public static class RecordingInspector
{
    /// <summary>A line longer than this is not a recorder's: its longest, a batch of every
    /// object's state, runs to tens of kilobytes.</summary>
    internal const int MaxLineBytes = 16 * 1024 * 1024;

    private const int MaxPlayers = 128;
    private const int ChunkBytes = 64 * 1024;

    public static async Task<RecordingInspection> InspectAsync(Stream gzipped, long maxRawBytes, CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var scan = new Scan();
        var partial = new ArrayBufferWriter<byte>();
        var chunk = ArrayPool<byte>.Shared.Rent(ChunkBytes);
        long raw = 0;
        try
        {
            await using var gzip = new GZipStream(gzipped, CompressionMode.Decompress, leaveOpen: true);
            int read;
            while ((read = await gzip.ReadAsync(chunk.AsMemory(0, ChunkBytes), ct)) > 0)
            {
                raw += read;
                if (raw > maxRawBytes)
                {
                    throw new RecordingRejectedException(
                        $"The recording unpacks to more than {maxRawBytes / (1024 * 1024)} MB.",
                        StatusCodes.Status413PayloadTooLarge);
                }
                hash.AppendData(chunk, 0, read);
                var rest = chunk.AsSpan(0, read);
                while (true)
                {
                    var newline = rest.IndexOf((byte)'\n');
                    if (newline < 0)
                    {
                        if (partial.WrittenCount + rest.Length > MaxLineBytes) throw NotARecording();
                        partial.Write(rest);
                        break;
                    }
                    if (partial.WrittenCount == 0)
                    {
                        scan.Line(rest[..newline]);
                    }
                    else
                    {
                        partial.Write(rest[..newline]);
                        scan.Line(partial.WrittenSpan);
                        partial.ResetWrittenCount();
                    }
                    rest = rest[(newline + 1)..];
                }
            }
            // The last line, when the recorder stopped without ending it (a crash).
            if (partial.WrittenCount > 0) scan.Line(partial.WrittenSpan);
        }
        catch (InvalidDataException ex)
        {
            throw new RecordingRejectedException("The file is not whole: its compression breaks off. Share it again.", ex);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(chunk);
        }

        if (!scan.SawHeader) throw NotARecording();
        return new RecordingInspection(
            scan.Version,
            scan.Start,
            scan.Level,
            scan.GameMode,
            scan.Mod,
            scan.ServerName,
            scan.RecordedBy,
            scan.Duration,
            scan.Players,
            raw,
            Convert.ToHexStringLower(hash.GetHashAndReset()));
    }

    /// <summary>A gzipped server log (<c>ev_*.xml</c>): that it unpacks, within the limit, to
    /// something that opens like XML. Its size unpacked.</summary>
    public static async Task<long> InspectServerLogAsync(Stream gzipped, long maxRawBytes, CancellationToken ct)
    {
        var chunk = ArrayPool<byte>.Shared.Rent(ChunkBytes);
        long raw = 0;
        var opened = false;
        try
        {
            await using var gzip = new GZipStream(gzipped, CompressionMode.Decompress, leaveOpen: true);
            int read;
            while ((read = await gzip.ReadAsync(chunk.AsMemory(0, ChunkBytes), ct)) > 0)
            {
                if (!opened)
                {
                    var text = chunk.AsSpan(0, read);
                    if (text.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF])) text = text[3..];
                    var first = text.TrimStart(" \t\r\n"u8);
                    if (first.IsEmpty && raw == 0 && read < ChunkBytes) continue;
                    if (first.IsEmpty || first[0] != (byte)'<')
                    {
                        throw new RecordingRejectedException("The server log is not an ev_*.xml event log.");
                    }
                    opened = true;
                }
                raw += read;
                if (raw > maxRawBytes)
                {
                    throw new RecordingRejectedException(
                        $"The server log unpacks to more than {maxRawBytes / (1024 * 1024)} MB.",
                        StatusCodes.Status413PayloadTooLarge);
                }
            }
        }
        catch (InvalidDataException ex)
        {
            throw new RecordingRejectedException("The server log is not whole: its compression breaks off.", ex);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(chunk);
        }
        if (!opened) throw new RecordingRejectedException("The server log is empty.");
        return raw;
    }

    private static RecordingRejectedException NotARecording() =>
        new("That is not a bf42plus recording. Share a replay_*.ndjson file.");

    /// <summary>The level's folder from a SetLevel path: <c>bf1942/levels/midway/</c> is
    /// <c>midway</c>.</summary>
    internal static string LevelOf(string path) =>
        path.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault()?.ToLowerInvariant() ?? "";

    /// <summary>The game type from a mode file: <c>conquest.con</c> is <c>conquest</c>.</summary>
    internal static string ModeOf(string modeFile)
    {
        var mode = modeFile.Trim();
        if (mode.EndsWith(".con", StringComparison.OrdinalIgnoreCase)) mode = mode[..^4];
        return mode.ToLowerInvariant();
    }

    /// <summary>The state of one pass over a recording's lines.</summary>
    private sealed class Scan
    {
        private readonly HashSet<string> seen = new(StringComparer.Ordinal);
        private readonly List<string> players = [];

        public bool SawHeader { get; private set; }
        public int Version { get; private set; }
        public string Start { get; private set; } = "";
        public string Level { get; private set; } = "";
        public string GameMode { get; private set; } = "";
        public string Mod { get; private set; } = "";
        public string ServerName { get; private set; } = "";
        public string RecordedBy { get; private set; } = "";
        public double Duration { get; private set; }
        public IReadOnlyList<string> Players => players;

        public void Line(ReadOnlySpan<byte> line)
        {
            line = line.TrimEnd((byte)'\r');
            if (line.Trim(" \t"u8).IsEmpty) return;
            if (!SawHeader)
            {
                Header(line);
                return;
            }
            // Past the header, a line that does not parse is skipped, as the viewer skips
            // it: a recording whose PC crashed ends in half a line.
            try
            {
                Record(line);
            }
            catch (JsonException)
            {
            }
        }

        private void Header(ReadOnlySpan<byte> line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line.ToArray());
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object
                    || !root.TryGetProperty("k", out var k) || k.ValueKind != JsonValueKind.String
                    || k.GetString() != "h")
                {
                    throw NotARecording();
                }
                Version = root.TryGetProperty("v", out var v) && v.TryGetInt32(out var version) ? version : 1;
                Start = String(root, "start");
                SawHeader = true;
            }
            catch (JsonException ex)
            {
                throw new RecordingRejectedException(NotARecording().Message, ex);
            }
        }

        /// <summary>One record: its kind and time off the front of the line, which is where
        /// the recorder writes them (<c>{"k":"e","t":12.5,"e":"setLevel",...}</c>), and the
        /// few records that describe the round read whole.</summary>
        private void Record(ReadOnlySpan<byte> line)
        {
            var reader = new Utf8JsonReader(line, isFinalBlock: true, state: default);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return;
            string? kind = null;
            string? eventName = null;
            var time = double.NaN;
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("k"u8))
                {
                    reader.Read();
                    kind = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                }
                else if (reader.ValueTextEquals("t"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.Number && reader.TryGetDouble(out var t)) time = t;
                }
                else if (reader.ValueTextEquals("e"u8))
                {
                    reader.Read();
                    eventName = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                }
                else
                {
                    reader.Skip();
                }
                if (kind is not null && !double.IsNaN(time) && (kind != "e" || eventName is not null)) break;
            }
            if (double.IsFinite(time) && time > Duration) Duration = time;

            if (kind == "roster")
            {
                Roster(line);
            }
            else if (kind == "e" && eventName is "serverInfo" or "serverName" or "setLevel" or "createPlayer")
            {
                Event(eventName, line);
            }
        }

        private void Event(string name, ReadOnlySpan<byte> line)
        {
            using var doc = JsonDocument.Parse(line.ToArray());
            var root = doc.RootElement;
            switch (name)
            {
                case "serverInfo":
                    Mod = String(root, "mod").ToLowerInvariant() is { Length: > 0 } mod ? mod : Mod;
                    break;
                case "serverName":
                    ServerName = String(root, "name") is { Length: > 0 } server ? server : ServerName;
                    break;
                case "setLevel":
                    Level = LevelOf(String(root, "level")) is { Length: > 0 } level ? level : Level;
                    GameMode = ModeOf(String(root, "mode")) is { Length: > 0 } mode ? mode : GameMode;
                    break;
                case "createPlayer":
                    Player(String(root, "name"));
                    break;
            }
        }

        /// <summary>Who was playing when a file begun after the join began:
        /// <c>[pid, team, ai, name, local]</c>, local the recording player.</summary>
        private void Roster(ReadOnlySpan<byte> line)
        {
            using var doc = JsonDocument.Parse(line.ToArray());
            if (!doc.RootElement.TryGetProperty("p", out var rows) || rows.ValueKind != JsonValueKind.Array) return;
            foreach (var row in rows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() < 4) continue;
                var name = row[3].ValueKind == JsonValueKind.String ? row[3].GetString() ?? "" : "";
                Player(name);
                var local = row.GetArrayLength() > 4 && row[4].ValueKind == JsonValueKind.Number
                    && row[4].TryGetInt32(out var flag) && flag != 0;
                if (local && name.Length > 0 && RecordedBy.Length == 0) RecordedBy = name;
            }
        }

        private void Player(string name)
        {
            name = name.Trim();
            if (name.Length == 0 || players.Count >= MaxPlayers || !seen.Add(name)) return;
            players.Add(name);
        }

        private static string String(JsonElement root, string property) =>
            root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()?.Trim() ?? ""
                : "";
    }
}
