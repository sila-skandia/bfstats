using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;

namespace api.Recordings;

/// <summary>
/// Reads a shared file as it streams and says whether it is what it claims to be. A recording:
/// its first line is the recorder's header (<c>{"k":"h",...}</c>, the check the viewer makes of
/// a dropped file) and every line after it is one of the recorder's records, a JSON object with
/// its kind in <c>k</c>, bar a last line a crash cut short. Along the way: how long it runs, its
/// SHA-256, and what it says about itself — its level, game type, mod, server, players and the
/// player who recorded it. A server log: an <c>ev_*.xml</c> event log, BF1942's own XML and
/// nothing else in it.
/// <para>
/// What is kept is what was read: the content goes to <c>stored</c> gzipped afresh, so bytes
/// the reading never saw (anything after the end of a gzip stream) are never served.
/// </para>
/// </summary>
public static class RecordingInspector
{
    /// <summary>A line longer than this is not a recorder's: its longest, a batch of every
    /// object's state, is 44 KB in the ten real recordings on the owner's PC (v2 to v5). A line
    /// is held whole while it is read, so this is also what one upload can make the API hold.</summary>
    internal const int MaxLineBytes = 1024 * 1024;

    /// <summary>
    /// A gzipped recording unpacks to no more than this many times its size, past
    /// <see cref="RatioFloor"/>. Real ones gzip four to eight to one; a gzip bomb, hundreds to
    /// a thousand, and every byte it unpacks to is read, hashed, parsed and gzipped again here:
    /// 3 MB sent that unpacked to the whole gigabyte cost 11 s of CPU.
    /// </summary>
    internal const long MaxRatio = 32;

    /// <summary>The same for a server log: XML that repeats itself, which gzips up to thirty
    /// to one.</summary>
    internal const long MaxServerLogRatio = 64;

    /// <summary>What any gzipped upload may unpack to, whatever its ratio: a file under this is
    /// not held to one.</summary>
    internal const long RatioFloor = 64L * 1024 * 1024;

    /// <summary>The longest a recording can say it runs. A record's <c>t</c> past this is the
    /// file's own nonsense and is not taken as the recording's length.</summary>
    internal const double MaxDurationSeconds = 24 * 3600;

    /// <summary>A run of a server log with no <c>&lt;</c> or <c>&gt;</c> in it longer than this
    /// is not the game's: its longest, a chat line, is a few hundred bytes. Bounding it bounds
    /// what the XML reader holds of any one text or tag.</summary>
    internal const int MaxServerLogRun = 64 * 1024;

    internal const int MaxPlayerName = 32;
    internal const int MaxServerName = 64;

    private const int MaxPlayers = 128;
    private const int ChunkBytes = 64 * 1024;

    /// <summary>The namespace BF1942's event logs are written in (<c>bf:log version="1.1"</c>).</summary>
    private const string EventLogNamespace = "http://www.dice.se/xmlns/bf/";

    /// <summary>
    /// Reads a recording, gzipped (as the browser sends it) or plain, from a seekable
    /// <paramref name="upload"/>, and writes what it read to <paramref name="stored"/>, gzipped
    /// afresh, when one is given. Throws <see cref="RecordingRejectedException"/> for a file that
    /// is not a bf42plus recording or unpacks past <paramref name="maxRawBytes"/>.
    /// </summary>
    public static async Task<RecordingInspection> InspectAsync(
        Stream upload, Stream? stored, long maxRawBytes, CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var scan = new Scan();
        var partial = new ArrayBufferWriter<byte>();
        var chunk = ArrayPool<byte>.Shared.Rent(ChunkBytes);
        long raw = 0;
        try
        {
            await using var content = await ContentAsync(upload, ct);
            await using var output = stored is null ? null : new GZipStream(stored, CompressionLevel.Optimal, leaveOpen: true);
            var limit = UnpackLimit(upload, content, maxRawBytes, MaxRatio);
            int read;
            while ((read = await content.ReadAsync(chunk.AsMemory(0, ChunkBytes), ct)) > 0)
            {
                raw += read;
                if (raw > limit)
                {
                    throw new RecordingRejectedException(
                        $"The recording unpacks to more than {limit / (1024 * 1024)} MB.",
                        StatusCodes.Status413PayloadTooLarge);
                }
                hash.AppendData(chunk, 0, read);
                if (output is not null) await output.WriteAsync(chunk.AsMemory(0, read), ct);
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
                        if (partial.WrittenCount + newline > MaxLineBytes) throw NotARecording();
                        partial.Write(rest[..newline]);
                        scan.Line(partial.WrittenSpan);
                        partial.ResetWrittenCount();
                    }
                    rest = rest[(newline + 1)..];
                }
            }
            // Before the last line is read as one a crash cut short: it may be the upload's
            // end cut off instead.
            if (content is GZipStream && !await WholeAsync(upload, raw, ct)) throw NotWhole();
            // The last line, when the recorder stopped without ending it (a crash).
            if (partial.WrittenCount > 0) scan.Line(partial.WrittenSpan);
        }
        catch (InvalidDataException ex)
        {
            throw new RecordingRejectedException(NotWhole().Message, ex);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(chunk);
        }

        if (!scan.SawHeader) throw NotARecording();
        if (scan.Records == 0)
        {
            throw new RecordingRejectedException("The recording is empty: there is nothing in it after its header.");
        }
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
            Convert.ToHexStringLower(hash.GetHashAndReset()),
            scan.Fingerprint());
    }

    /// <summary>
    /// A server log (<c>ev_*.xml</c>), gzipped or plain, from a seekable
    /// <paramref name="upload"/>: BF1942's event log, rooted at <c>bf:log</c> with every element
    /// in its namespace, no DTD, no processing instruction past the XML declaration, within the
    /// limit unpacked. The server appends to the file while the round runs, so it usually ends
    /// part way through an element: a log that is well-formed as far as it goes is one. What was
    /// read goes to <paramref name="stored"/>, gzipped afresh. Its size unpacked.
    /// </summary>
    public static async Task<long> InspectServerLogAsync(Stream upload, Stream? stored, long maxRawBytes, CancellationToken ct)
    {
        try
        {
            await using var content = await ContentAsync(upload, ct);
            await using var output = stored is null ? null : new GZipStream(stored, CompressionLevel.Optimal, leaveOpen: true);
            await using var watched = new ServerLogStream(content, output, UnpackLimit(upload, content, maxRawBytes, MaxServerLogRatio));
            var settings = new XmlReaderSettings
            {
                Async = true,
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                IgnoreComments = true,
                IgnoreWhitespace = true,
                // Characters the game writes that XML 1.0 does not allow (a chat line's control
                // bytes) are the log's to carry: what matters here is its markup.
                CheckCharacters = false,
                CloseInput = false,
            };
            var sawRoot = false;
            var rootClosed = false;
            try
            {
                using var reader = XmlReader.Create(watched, settings);
                while (await reader.ReadAsync())
                {
                    switch (reader.NodeType)
                    {
                        case XmlNodeType.XmlDeclaration:
                        case XmlNodeType.Text:
                        case XmlNodeType.CDATA:
                        case XmlNodeType.Whitespace:
                        case XmlNodeType.SignificantWhitespace:
                            break;
                        case XmlNodeType.Element:
                            if (!reader.NamespaceURI.StartsWith(EventLogNamespace, StringComparison.Ordinal)
                                || (!sawRoot && reader.LocalName != "log"))
                            {
                                throw NotAServerLog();
                            }
                            sawRoot = true;
                            if (reader.IsEmptyElement && reader.Depth == 0) rootClosed = true;
                            Attributes(reader);
                            break;
                        case XmlNodeType.EndElement:
                            if (reader.Depth == 0) rootClosed = true;
                            break;
                        default:
                            // A processing instruction (an xml-stylesheet), an entity: not the game's.
                            throw NotAServerLog();
                    }
                }
            }
            catch (XmlException) when (watched.Ended && sawRoot && !rootClosed)
            {
                // The whole file was read and it stops inside the log: the round was still
                // being written.
            }
            catch (XmlException ex)
            {
                if (watched.Ended && content is GZipStream && !await WholeAsync(upload, watched.Raw, ct)) throw NotWhole("The server log");
                throw new RecordingRejectedException(NotAServerLog().Message, ex);
            }
            if (!sawRoot) throw NotAServerLog();
            // The reader stops at the end of the log: whatever follows is still the upload's,
            // and still has to be read and kept whole.
            await watched.CopyToAsync(Stream.Null, ct);
            if (content is GZipStream && !await WholeAsync(upload, watched.Raw, ct)) throw NotWhole("The server log");
            return watched.Raw;
        }
        catch (InvalidDataException ex)
        {
            throw new RecordingRejectedException(NotWhole("The server log").Message, ex);
        }
    }

    /// <summary>
    /// That a gzipped upload was all there. zlib checks a gzip stream's trailer, the CRC-32
    /// and length of what it holds, when it reaches it; a stream cut short of it just ends, and
    /// GZipStream hands back the half it had. A whole one ends in that trailer: its last four
    /// bytes are the length unpacked. So does no stream with anything after its end, or more
    /// than one member, the browser's never has.
    /// </summary>
    private static async Task<bool> WholeAsync(Stream upload, long raw, CancellationToken ct)
    {
        if (upload.Length < 8) return false;
        upload.Seek(-4, SeekOrigin.End);
        var size = new byte[4];
        await upload.ReadExactlyAsync(size, ct);
        return BinaryPrimitives.ReadUInt32LittleEndian(size) == unchecked((uint)raw);
    }

    /// <summary>An element's attributes: plain ones, and namespace declarations of the event
    /// log's own namespace only. XHTML, SVG or anything else declared in it is not the game's.</summary>
    private static void Attributes(XmlReader reader)
    {
        if (!reader.MoveToFirstAttribute()) return;
        do
        {
            var declaration = reader.NamespaceURI == "http://www.w3.org/2000/xmlns/";
            if (declaration ? !reader.Value.StartsWith(EventLogNamespace, StringComparison.Ordinal) : reader.NamespaceURI.Length > 0)
            {
                throw NotAServerLog();
            }
        }
        while (reader.MoveToNextAttribute());
        reader.MoveToElement();
    }

    /// <summary>How far <paramref name="upload"/> may unpack: <paramref name="maxRawBytes"/>, and
    /// for a gzipped one no further than <paramref name="ratio"/> times its size past
    /// <see cref="RatioFloor"/>.</summary>
    private static long UnpackLimit(Stream upload, Stream content, long maxRawBytes, long ratio) =>
        content is GZipStream ? Math.Min(maxRawBytes, Math.Max(RatioFloor, upload.Length * ratio)) : maxRawBytes;

    /// <summary>The upload's content: gunzipped when it starts as gzip does, else as it came.</summary>
    private static async Task<Stream> ContentAsync(Stream upload, CancellationToken ct)
    {
        var magic = new byte[2];
        var read = await upload.ReadAtLeastAsync(magic, magic.Length, throwOnEndOfStream: false, ct);
        upload.Seek(-read, SeekOrigin.Current);
        return read == 2 && magic[0] == 0x1f && magic[1] == 0x8b
            ? new GZipStream(upload, CompressionMode.Decompress, leaveOpen: true)
            : new NotClosing(upload);
    }

    private static RecordingRejectedException NotARecording() =>
        new("That is not a bf42plus recording. Share a replay_*.ndjson file.");

    private static RecordingRejectedException Damaged(int line) =>
        new($"The recording is damaged: line {line} is not one of the recorder's records.");

    private static RecordingRejectedException NotWhole(string what = "The file") =>
        new($"{what} is not whole: its compression breaks off. Share it again.");

    private static RecordingRejectedException NotAServerLog() =>
        new("The server log is not a BF1942 event log (ev_*.xml).");

    /// <summary>The level's folder from a SetLevel path: <c>bf1942/levels/midway/</c> is
    /// <c>midway</c>; '' for one that is not a level's name.</summary>
    internal static string LevelOf(string path) =>
        RecordingText.Id(path.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).LastOrDefault());

    /// <summary>The game type from a mode file: <c>conquest.con</c> is <c>conquest</c>.</summary>
    internal static string ModeOf(string modeFile)
    {
        var mode = modeFile.Trim();
        if (mode.EndsWith(".con", StringComparison.OrdinalIgnoreCase)) mode = mode[..^4];
        return RecordingText.Id(mode);
    }

    /// <summary>Who said a chat line, as the game draws it: <c>skandia: gf</c> is skandia's
    /// (replay-recording.js <c>speakerOf</c>).</summary>
    internal static string SpeakerOf(string text)
    {
        var at = text.IndexOf(": ", StringComparison.Ordinal);
        if (at <= 0) return "";
        var name = text[..at];
        foreach (var side in (string[])[" [allies]", " [axis]"])
        {
            if (name.EndsWith(side, StringComparison.OrdinalIgnoreCase)) name = name[..^side.Length];
        }
        return RecordingText.Name(name.Replace("\u0080", "", StringComparison.Ordinal), MaxPlayerName);
    }

    /// <summary>The state of one pass over a recording's lines.</summary>
    private sealed class Scan
    {
        /// <summary>A pid is a byte in BF1942; anything past this is not one.</summary>
        private const int MaxPid = 255;

        /// <summary>The names one pid's chat goes out under that are counted: a pid passes
        /// from player to player, but not many times in a round.</summary>
        private const int MaxSpeakersPerPid = 8;

        private readonly HashSet<string> seen = new(StringComparer.Ordinal);
        private readonly List<string> players = [];
        private readonly Dictionary<int, string> names = [];
        private readonly HashSet<string> humans = new(StringComparer.Ordinal);
        private readonly Dictionary<int, Dictionary<string, int>> speakers = [];
        private readonly RoundFingerprintBuilder round = new();
        private int lineNumber;
        private int? damaged;
        private string rosterLocal = "";
        private int? localPid;
        private string localName = "";

        private enum Field
        {
            Other,
            Kind,
            Time,
            Event,
            Pid,
            Local,
        }

        public bool SawHeader { get; private set; }
        public int Records { get; private set; }
        public int Version { get; private set; }
        public string Start { get; private set; } = "";
        public string Level { get; private set; } = "";
        public string GameMode { get; private set; } = "";
        public string Mod { get; private set; } = "";
        public string ServerName { get; private set; } = "";
        public double Duration { get; private set; }
        public IReadOnlyList<string> Players => players;

        /// <summary>What finds the other recordings of its round (features/replay-feed, "Rounds").</summary>
        public RoundFingerprint Fingerprint() => round.Build(Duration);

        /// <summary>
        /// The player whose client made the recording, as the viewer finds him
        /// (recording-inspect.js <c>recorderName</c>): the one the roster marks <c>local</c> (a
        /// file begun mid-round), else the one whose own shots the recorder marks (<c>local</c>
        /// on a v4 round, a v3 trigger press) under the name his pid had then, or failing that
        /// the name his chat goes out under, else the round's only human. '' when the file
        /// cannot say.
        /// </summary>
        public string RecordedBy =>
            rosterLocal.Length > 0 ? rosterLocal
            : localName.Length > 0 ? localName
            : localPid is { } pid && speakers.TryGetValue(pid, out var said) ? said.MaxBy(name => name.Value).Key
            : humans.Count == 1 ? humans.Single()
            : "";

        public void Line(ReadOnlySpan<byte> line)
        {
            lineNumber++;
            line = line.TrimEnd((byte)'\r');
            if (line.Trim(" \t"u8).IsEmpty) return;
            // Only the last line may be broken: a crash cuts it short. One with records after
            // it is not the recorder's.
            if (damaged is { } at) throw Damaged(at);
            if (!SawHeader)
            {
                Header(line);
                return;
            }
            if (!Record(line)) damaged = lineNumber;
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
                Start = RecordingText.Stamp(String(root, "start"));
                SawHeader = true;
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                throw new RecordingRejectedException(NotARecording().Message, ex);
            }
        }

        /// <summary>One record, read whole: a JSON object and nothing after it, its kind in
        /// <c>k</c>. Its time, and the few records that say who and where, are taken as it
        /// goes. False for a line that is not one.</summary>
        private bool Record(ReadOnlySpan<byte> line)
        {
            string? kind = null;
            string? eventName = null;
            var time = double.NaN;
            int? pid = null;
            var local = false;
            try
            {
                var reader = new Utf8JsonReader(line, isFinalBlock: true, state: default);
                if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return false;
                while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
                {
                    var field = FieldOf(ref reader);
                    reader.Read();
                    switch (field)
                    {
                        case Field.Kind:
                            kind = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                            break;
                        case Field.Time when reader.TokenType == JsonTokenType.Number && reader.TryGetDouble(out var t):
                            time = t;
                            break;
                        case Field.Event:
                            eventName = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                            break;
                        case Field.Pid when reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var id):
                            pid = id;
                            break;
                        case Field.Local:
                            local = reader.TokenType == JsonTokenType.True
                                || (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var flag) && flag != 0);
                            break;
                    }
                    // A value that is an object or an array is read through, so a line that is
                    // broken anywhere is found.
                    reader.Skip();
                }
                if (reader.TokenType != JsonTokenType.EndObject || reader.Read()) return false;
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                return false;
            }
            if (kind is null) return false;

            try
            {
                switch (kind)
                {
                    case "roster":
                        Roster(line);
                        break;
                    case "chat" when pid is >= 0:
                        Chat(pid.Value, line);
                        break;
                    // v4 and later: a round the recording player's own client fired.
                    case "f" when local && pid is >= 0 and <= MaxPid:
                        Shot(pid.Value);
                        break;
                    // v3: the recording player's own trigger press, and nobody else's.
                    case "e" when eventName == "fire" && pid is >= 0 and <= MaxPid:
                        Shot(pid.Value);
                        break;
                    case "e" when eventName is "serverInfo" or "serverName" or "setLevel" or "createPlayer":
                        Event(eventName, line);
                        break;
                }
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                // Text that is not UTF-8: the recorder writes every byte past ASCII as \u00XX.
                return false;
            }
            Records++;
            if (double.IsFinite(time) && time > Duration && time <= MaxDurationSeconds) Duration = time;
            round.Line(kind, eventName, time, line);
            return true;
        }

        private void Event(string name, ReadOnlySpan<byte> line)
        {
            using var doc = JsonDocument.Parse(line.ToArray());
            var root = doc.RootElement;
            switch (name)
            {
                case "serverInfo":
                    Mod = RecordingText.Id(String(root, "mod")) is { Length: > 0 } mod ? mod : Mod;
                    break;
                case "serverName":
                    ServerName = RecordingText.Line(String(root, "name"), MaxServerName) is { Length: > 0 } server ? server : ServerName;
                    break;
                case "setLevel":
                    Level = LevelOf(String(root, "level")) is { Length: > 0 } level ? level : Level;
                    GameMode = ModeOf(String(root, "mode")) is { Length: > 0 } mode ? mode : GameMode;
                    break;
                case "createPlayer":
                    var ai = root.TryGetProperty("ai", out var flag) && flag.ValueKind == JsonValueKind.Number
                        && flag.TryGetInt32(out var bot) ? bot != 0 : (bool?)null;
                    Player(Pid(root), String(root, "name"), ai);
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
                var pid = row[0].ValueKind == JsonValueKind.Number && row[0].TryGetInt32(out var id) ? id : (int?)null;
                var ai = row[2].ValueKind == JsonValueKind.Number && row[2].TryGetInt32(out var bot) ? bot != 0 : (bool?)null;
                var name = Player(pid, row[3].ValueKind == JsonValueKind.String ? row[3].GetString() ?? "" : "", ai);
                var local = row.GetArrayLength() > 4 && row[4].ValueKind == JsonValueKind.Number
                    && row[4].TryGetInt32(out var mark) && mark != 0;
                if (local && name.Length > 0 && rosterLocal.Length == 0) rosterLocal = name;
            }
        }

        /// <summary>The recording player's first shot: whose pid it is, and the name that pid
        /// has at that moment (a public server hands a leaver's pid to the next to join).</summary>
        private void Shot(int pid)
        {
            if (localPid is not null) return;
            localPid = pid;
            localName = names.GetValueOrDefault(pid, "");
        }

        /// <summary>A chat line, for the name its pid's chat goes out under: a file begun after
        /// the join, by a recorder that wrote no roster, names the recording player nowhere else.</summary>
        private void Chat(int pid, ReadOnlySpan<byte> line)
        {
            if (pid > MaxPid) return;
            using var doc = JsonDocument.Parse(line.ToArray());
            if (SpeakerOf(String(doc.RootElement, "text")) is not { Length: > 0 } name) return;
            if (!speakers.TryGetValue(pid, out var said)) speakers[pid] = said = new(StringComparer.Ordinal);
            if (said.Count < MaxSpeakersPerPid || said.ContainsKey(name)) said[name] = said.GetValueOrDefault(name) + 1;
        }

        /// <summary>A player the round names: listed once, under a name cut to what the game
        /// allows, and remembered against his pid. The name as kept.</summary>
        private string Player(int? pid, string raw, bool? ai)
        {
            var name = RecordingText.Name(raw, MaxPlayerName);
            if (name.Length == 0) return "";
            if (pid is >= 0 and <= MaxPid) names[pid.Value] = name;
            if (ai == false && humans.Count < MaxPlayers) humans.Add(name);
            if (players.Count < MaxPlayers && seen.Add(name)) players.Add(name);
            return name;
        }

        private static Field FieldOf(ref Utf8JsonReader reader) =>
            reader.ValueTextEquals("k"u8) ? Field.Kind
            : reader.ValueTextEquals("t"u8) ? Field.Time
            : reader.ValueTextEquals("e"u8) ? Field.Event
            : reader.ValueTextEquals("pid"u8) ? Field.Pid
            : reader.ValueTextEquals("local"u8) ? Field.Local
            : Field.Other;

        private static int? Pid(JsonElement root) =>
            root.TryGetProperty("pid", out var pid) && pid.ValueKind == JsonValueKind.Number && pid.TryGetInt32(out var id) ? id : null;

        private static string String(JsonElement root, string property) =>
            root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()?.Trim() ?? ""
                : "";
    }

    /// <summary>
    /// A server log on its way to the XML reader: counted against the limit, kept (gzipped) as
    /// it passes, watched for a run without markup longer than any the game writes, and marked
    /// once it has all been read.
    /// </summary>
    private sealed class ServerLogStream(Stream content, Stream? stored, long maxRawBytes) : Stream
    {
        private int run;

        public long Raw { get; private set; }

        /// <summary>The whole log has been read: the reader asked for more and there was none.</summary>
        public bool Ended { get; private set; }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => Raw; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) =>
            ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await content.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                Ended = true;
                return 0;
            }
            Raw += read;
            if (Raw > maxRawBytes)
            {
                throw new RecordingRejectedException(
                    $"The server log unpacks to more than {maxRawBytes / (1024 * 1024)} MB.",
                    StatusCodes.Status413PayloadTooLarge);
            }
            foreach (var b in buffer.Span[..read])
            {
                run = b is (byte)'<' or (byte)'>' ? 0 : run + 1;
                if (run > MaxServerLogRun) throw NotAServerLog();
            }
            if (stored is not null) await stored.WriteAsync(buffer[..read], cancellationToken);
            return read;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /// <summary>A plain upload read as it is, without disposing the file it is read from.</summary>
    private sealed class NotClosing(Stream inner) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            inner.ReadAsync(buffer, cancellationToken);

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            inner.ReadAsync(buffer, offset, count, cancellationToken);

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
