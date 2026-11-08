using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using Microsoft.Extensions.Logging;

namespace api.Shorts;

/// <summary>
/// Rewrites a fragmented MP4 as a plain one, its index first (features/replay-shorts,
/// "Studio shares embed in Discord"). A browser's MediaRecorder writes MP4 in fragments: a
/// <c>moov</c> whose sample tables are empty (the clip is 0 s long by it), then a run of
/// <c>moof</c>/<c>mdat</c> pairs. A player copes; Discord's link preview reads the index and
/// showed nothing (2026-11-08, the owner's Arnhem share).
/// </summary>
public interface IVideoFlattener
{
    /// <summary>Flattens <paramref name="path"/> in place when it is fragmented. True when the
    /// file was rewritten; false when it needed nothing or could not be (it is left as it was).</summary>
    Task<bool> FlattenAsync(string path, CancellationToken ct);
}

/// <summary>
/// The flattening in C#, no encoder: every sample the fragments describe (their
/// <c>trun</c>s, with the <c>tfhd</c>'s and <c>trex</c>'s defaults) goes into one
/// <c>mdat</c>, a run a chunk in the order they came, and the <c>moov</c> before it gets full
/// sample tables (<c>stts</c>, <c>ctts</c>, <c>stss</c>, <c>stsc</c>, <c>stsz</c>,
/// <c>stco</c>) and its durations. Only the index boxes are read into memory; the media is
/// copied across. Anything it does not understand leaves the file as it was.
/// </summary>
public sealed class Mp4Flattener(ILogger<Mp4Flattener> logger) : IVideoFlattener
{
    /// <summary>Index boxes larger than this are not an MP4 it will rewrite.</summary>
    private const long MaxIndexBytes = 32L * 1024 * 1024;

    private static readonly HashSet<string> Containers = ["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "traf"];

    public async Task<bool> FlattenAsync(string path, CancellationToken ct)
    {
        var started = Stopwatch.StartNew();
        var flat = path + ".flat.mp4";
        try
        {
            Plan? plan;
            await using (var source = File.OpenRead(path))
            {
                plan = await PlanAsync(source, ct);
                if (plan is null) return false;
                await using var target = new FileStream(flat, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true);
                await WriteAsync(plan, source, target, ct);
            }
            var before = new FileInfo(path).Length;
            File.Move(flat, path, overwrite: true);
            logger.LogInformation(
                "A Short's fragmented video flattened in {Ms} ms: {Fragments} fragments, {Samples} samples, {Before} to {After} bytes",
                started.ElapsedMilliseconds, plan.Fragments, plan.Tracks.Sum(t => t.Samples.Count), before, new FileInfo(path).Length);
            return true;
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or ArgumentException or OverflowException)
        {
            logger.LogWarning(ex, "A Short's fragmented video was kept as it came");
            return false;
        }
        finally
        {
            try
            {
                if (File.Exists(flat)) File.Delete(flat);
            }
            catch (IOException)
            {
            }
        }
    }

    // --- reading -------------------------------------------------------------------------

    private sealed record Sample(long Offset, uint Size, uint Duration, int CompositionOffset, bool Sync, uint Description);

    /// <summary>A run of samples next to each other in the source: one chunk in the output.</summary>
    private sealed record Run(Track Track, int First, int Count);

    private sealed class Track(uint id)
    {
        public uint Id { get; } = id;
        public Box Trak { get; init; } = null!;
        public uint Timescale { get; set; }
        public uint DefaultDescription { get; set; } = 1;
        public uint DefaultDuration { get; set; }
        public uint DefaultSize { get; set; }
        public uint DefaultFlags { get; set; }
        public List<Sample> Samples { get; } = [];
        public ulong DecodeEnd { get; set; }
        public bool Started { get; set; }

        /// <summary>Where the track's first fragment starts in its own time: Safari's video
        /// starts a few hundredths of a second after its audio. Kept as an edit list.</summary>
        public ulong FirstDecode { get; set; }
    }

    private sealed record Plan(Box Ftyp, Box Moov, List<Track> Tracks, List<Run> Runs, int Fragments);

    /// <summary>A box: its type, and its children (a container) or its payload.</summary>
    private sealed class Box(string type, byte[]? payload, List<Box>? children)
    {
        public string Type { get; } = type;
        public byte[]? Payload { get; set; } = payload;
        public List<Box>? Children { get; } = children;
        public Box? Child(string type) => Children?.FirstOrDefault(c => c.Type == type);
        public IEnumerable<Box> All(string type) => Children?.Where(c => c.Type == type) ?? [];
    }

    /// <summary>What the file holds, or null when it is not a fragmented MP4 it can rewrite.</summary>
    private static async Task<Plan?> PlanAsync(FileStream source, CancellationToken ct)
    {
        Box? ftyp = null;
        Box? moov = null;
        var tracks = new Dictionary<uint, Track>();
        var runs = new List<Run>();
        var fragments = 0;
        long at = 0;
        var length = source.Length;
        while (at + 8 <= length)
        {
            var (type, size, header) = await HeaderAsync(source, at, length, ct);
            if (type is "ftyp" or "moov" or "moof")
            {
                if (size > MaxIndexBytes) throw new InvalidDataException($"a {type} of {size} bytes");
                var payload = await ReadAsync(source, at + header, (int)(size - header), ct);
                switch (type)
                {
                    case "ftyp":
                        ftyp = new Box(type, payload, null);
                        break;
                    case "moov":
                        moov = Parse(type, payload);
                        foreach (var track in TracksOf(moov)) tracks[track.Id] = track;
                        break;
                    default:
                        if (moov is null) throw new InvalidDataException("a moof before the moov");
                        fragments++;
                        ReadFragment(payload, at, tracks, runs);
                        break;
                }
            }
            at += size;
        }
        if (fragments == 0 || ftyp is null || moov is null || tracks.Count == 0) return null;
        if (tracks.Values.Any(t => t.Samples.Count == 0)) throw new InvalidDataException("a track with no samples");
        foreach (var t in tracks.Values)
        {
            if (t.Samples.Any(s => s.Offset < 0 || s.Offset + s.Size > length)) throw new InvalidDataException("a sample outside the file");
        }
        return new Plan(ftyp, moov, [.. tracks.Values], runs, fragments);
    }

    private static async Task<(string Type, long Size, int Header)> HeaderAsync(FileStream source, long at, long length, CancellationToken ct)
    {
        var head = await ReadAsync(source, at, (int)Math.Min(16, length - at), ct);
        long size = BinaryPrimitives.ReadUInt32BigEndian(head);
        var type = Encoding.ASCII.GetString(head, 4, 4);
        var header = 8;
        if (size == 1)
        {
            if (head.Length < 16) throw new InvalidDataException("a cut-off box header");
            size = checked((long)BinaryPrimitives.ReadUInt64BigEndian(head.AsSpan(8)));
            header = 16;
        }
        else if (size == 0)
        {
            size = length - at;
        }
        if (size < header || at + size > length) throw new InvalidDataException($"a {type} box that runs past the file");
        return (type, size, header);
    }

    private static async Task<byte[]> ReadAsync(FileStream source, long at, int count, CancellationToken ct)
    {
        var buffer = new byte[count];
        source.Position = at;
        await source.ReadExactlyAsync(buffer, ct);
        return buffer;
    }

    /// <summary>A box's children, those that are containers parsed in turn.</summary>
    private static Box Parse(string type, byte[] payload)
    {
        var children = new List<Box>();
        var at = 0;
        while (at + 8 <= payload.Length)
        {
            long size = BinaryPrimitives.ReadUInt32BigEndian(payload.AsSpan(at));
            var childType = Encoding.ASCII.GetString(payload, at + 4, 4);
            var header = 8;
            if (size == 1)
            {
                size = checked((long)BinaryPrimitives.ReadUInt64BigEndian(payload.AsSpan(at + 8)));
                header = 16;
            }
            else if (size == 0)
            {
                size = payload.Length - at;
            }
            if (size < header || at + size > payload.Length) throw new InvalidDataException($"a {childType} box that runs past its parent");
            var body = payload[(at + header)..(int)(at + size)];
            children.Add(Containers.Contains(childType) ? Parse(childType, body) : new Box(childType, body, null));
            at += (int)size;
        }
        return new Box(type, null, children);
    }

    private static IEnumerable<Track> TracksOf(Box moov)
    {
        var trex = moov.Child("mvex")?.All("trex").ToDictionary(t => BinaryPrimitives.ReadUInt32BigEndian(t.Payload.AsSpan(4)))
            ?? throw new InvalidDataException("a moov with no mvex");
        foreach (var trak in moov.All("trak"))
        {
            var tkhd = trak.Child("tkhd")?.Payload ?? throw new InvalidDataException("a trak with no tkhd");
            var id = BinaryPrimitives.ReadUInt32BigEndian(tkhd.AsSpan(tkhd[0] == 1 ? 20 : 12));
            var mdhd = trak.Child("mdia")?.Child("mdhd")?.Payload ?? throw new InvalidDataException("a trak with no mdhd");
            var track = new Track(id)
            {
                Trak = trak,
                Timescale = BinaryPrimitives.ReadUInt32BigEndian(mdhd.AsSpan(mdhd[0] == 1 ? 20 : 12)),
            };
            if (!trex.TryGetValue(id, out var defaults)) throw new InvalidDataException($"no trex for track {id}");
            var d = defaults.Payload!;
            track.DefaultDescription = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(8));
            track.DefaultDuration = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(12));
            track.DefaultSize = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(16));
            track.DefaultFlags = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(20));
            yield return track;
        }
    }

    /// <summary>A <c>moof</c>'s samples, each where it lies in the file (<paramref name="moofStart"/>
    /// is the box's first byte, which data offsets are counted from).</summary>
    private static void ReadFragment(byte[] payload, long moofStart, Dictionary<uint, Track> tracks, List<Run> runs)
    {
        var moof = Parse("moof", payload);
        long previousEnd = moofStart;
        var first = true;
        foreach (var traf in moof.All("traf"))
        {
            var tfhd = traf.Child("tfhd")?.Payload ?? throw new InvalidDataException("a traf with no tfhd");
            var flags = Flags(tfhd);
            var p = 4;
            var id = BinaryPrimitives.ReadUInt32BigEndian(tfhd.AsSpan(p));
            p += 4;
            if (!tracks.TryGetValue(id, out var track)) throw new InvalidDataException($"a traf for unknown track {id}");
            long baseOffset = (flags & 0x20000) != 0 || first ? moofStart : previousEnd;
            if ((flags & 0x1) != 0)
            {
                baseOffset = checked((long)BinaryPrimitives.ReadUInt64BigEndian(tfhd.AsSpan(p)));
                p += 8;
            }
            var description = track.DefaultDescription;
            var duration = track.DefaultDuration;
            var size = track.DefaultSize;
            var sampleFlags = track.DefaultFlags;
            if ((flags & 0x2) != 0) { description = BinaryPrimitives.ReadUInt32BigEndian(tfhd.AsSpan(p)); p += 4; }
            if ((flags & 0x8) != 0) { duration = BinaryPrimitives.ReadUInt32BigEndian(tfhd.AsSpan(p)); p += 4; }
            if ((flags & 0x10) != 0) { size = BinaryPrimitives.ReadUInt32BigEndian(tfhd.AsSpan(p)); p += 4; }
            if ((flags & 0x20) != 0) { sampleFlags = BinaryPrimitives.ReadUInt32BigEndian(tfhd.AsSpan(p)); }

            // Where this fragment's samples start in the track's own time: a gap since the last
            // fragment is added to the sample before it, so nothing drifts.
            if (traf.Child("tfdt")?.Payload is { } tfdt)
            {
                var decode = tfdt[0] == 1 ? BinaryPrimitives.ReadUInt64BigEndian(tfdt.AsSpan(4)) : BinaryPrimitives.ReadUInt32BigEndian(tfdt.AsSpan(4));
                if (!track.Started)
                {
                    track.FirstDecode = decode;
                    track.DecodeEnd = decode;
                }
                else if (decode > track.DecodeEnd && track.Samples.Count > 0)
                {
                    var last = track.Samples[^1];
                    track.Samples[^1] = last with { Duration = checked((uint)(last.Duration + (decode - track.DecodeEnd))) };
                    track.DecodeEnd = decode;
                }
            }

            var dataAt = baseOffset;
            foreach (var trun in traf.All("trun"))
            {
                var t = trun.Payload!;
                var version = t[0];
                var runFlags = Flags(t);
                var q = 4;
                var count = BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q));
                q += 4;
                if ((runFlags & 0x1) != 0)
                {
                    dataAt = baseOffset + BinaryPrimitives.ReadInt32BigEndian(t.AsSpan(q));
                    q += 4;
                }
                uint? firstFlags = null;
                if ((runFlags & 0x4) != 0)
                {
                    firstFlags = BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q));
                    q += 4;
                }
                var firstSample = track.Samples.Count;
                for (var i = 0; i < count; i++)
                {
                    var d = duration;
                    var s = size;
                    var f = i == 0 && firstFlags is { } ff ? ff : sampleFlags;
                    var cts = 0;
                    if ((runFlags & 0x100) != 0) { d = BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q)); q += 4; }
                    if ((runFlags & 0x200) != 0) { s = BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q)); q += 4; }
                    if ((runFlags & 0x400) != 0) { f = BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q)); q += 4; }
                    if ((runFlags & 0x800) != 0)
                    {
                        cts = version == 0 ? checked((int)BinaryPrimitives.ReadUInt32BigEndian(t.AsSpan(q))) : BinaryPrimitives.ReadInt32BigEndian(t.AsSpan(q));
                        q += 4;
                    }
                    track.Samples.Add(new Sample(dataAt, s, d, cts, (f & 0x10000) == 0, description));
                    dataAt += s;
                    track.DecodeEnd += d;
                }
                track.Started = true;
                if (count > 0) runs.Add(new Run(track, firstSample, (int)count));
            }
            previousEnd = dataAt;
            first = false;
        }
    }

    private static uint Flags(byte[] fullBox) => (uint)(fullBox[1] << 16 | fullBox[2] << 8 | fullBox[3]);

    // --- writing -------------------------------------------------------------------------

    private static async Task WriteAsync(Plan plan, FileStream source, FileStream target, CancellationToken ct)
    {
        // The moov's size does not depend on the offsets in it: lay it out with offsets 0, then
        // again with the real ones.
        var mediaBytes = plan.Tracks.Sum(t => t.Samples.Sum(s => 0L + s.Size));
        var ftyp = Serialize(plan.Ftyp);
        var mdatHeader = mediaBytes + 8 > uint.MaxValue ? 16 : 8;
        var moovSize = Serialize(Rebuild(plan, 0, mediaBytes + mdatHeader > uint.MaxValue)).Length;
        var mediaStart = ftyp.Length + moovSize + mdatHeader;
        var moov = Serialize(Rebuild(plan, mediaStart, mediaStart + mediaBytes > uint.MaxValue));
        if (moov.Length != moovSize) throw new InvalidDataException("the index changed size as it was laid out");

        await target.WriteAsync(ftyp, ct);
        await target.WriteAsync(moov, ct);
        var head = new byte[mdatHeader];
        if (mdatHeader == 8)
        {
            BinaryPrimitives.WriteUInt32BigEndian(head, checked((uint)(mediaBytes + 8)));
            Encoding.ASCII.GetBytes("mdat").CopyTo(head, 4);
        }
        else
        {
            BinaryPrimitives.WriteUInt32BigEndian(head, 1);
            Encoding.ASCII.GetBytes("mdat").CopyTo(head, 4);
            BinaryPrimitives.WriteUInt64BigEndian(head.AsSpan(8), (ulong)(mediaBytes + 16));
        }
        await target.WriteAsync(head, ct);
        var buffer = new byte[1 << 16];
        foreach (var run in plan.Runs)
        {
            foreach (var sample in run.Track.Samples.Skip(run.First).Take(run.Count))
            {
                source.Position = sample.Offset;
                var left = (long)sample.Size;
                while (left > 0)
                {
                    var n = await source.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, left)), ct);
                    if (n == 0) throw new InvalidDataException("a sample cut off by the end of the file");
                    await target.WriteAsync(buffer.AsMemory(0, n), ct);
                    left -= n;
                }
            }
        }
    }

    /// <summary>The moov with full sample tables, chunk offsets counted from
    /// <paramref name="mediaStart"/>, and no mvex.</summary>
    private static Box Rebuild(Plan plan, long mediaStart, bool wide)
    {
        // Each run is a chunk; its offset is where it lands in the new mdat.
        var chunkOffsets = plan.Tracks.ToDictionary(t => t, _ => new List<long>());
        var chunkSizes = plan.Tracks.ToDictionary(t => t, _ => new List<(int Count, uint Description)>());
        var offset = mediaStart;
        foreach (var run in plan.Runs)
        {
            chunkOffsets[run.Track].Add(offset);
            chunkSizes[run.Track].Add((run.Count, run.Track.Samples[run.First].Description));
            for (var i = run.First; i < run.First + run.Count; i++) offset += run.Track.Samples[i].Size;
        }

        var mvhd = plan.Moov.Child("mvhd")?.Payload ?? throw new InvalidDataException("a moov with no mvhd");
        var movieScale = BinaryPrimitives.ReadUInt32BigEndian(mvhd.AsSpan(mvhd[0] == 1 ? 20 : 12));
        if (movieScale == 0) throw new InvalidDataException("a movie timescale of 0");
        ulong movieDuration = 0;
        var children = new List<Box>();
        foreach (var child in plan.Moov.Children!)
        {
            if (child.Type == "mvex") continue;
            if (child.Type != "trak")
            {
                children.Add(child);
                continue;
            }
            var track = plan.Tracks.First(t => t.Trak == child);
            if (track.Timescale == 0) throw new InvalidDataException("a track timescale of 0");
            var mediaDuration = track.Samples.Aggregate(0UL, (s, x) => s + x.Duration);
            var inMovie = mediaDuration * movieScale / track.Timescale;
            // A track that starts late: an empty edit for the wait, then the whole track.
            var wait = child.Child("edts") is null ? track.FirstDecode * movieScale / track.Timescale : 0;
            movieDuration = Math.Max(movieDuration, wait + inMovie);
            var trak = RebuildTrak(child, track, mediaDuration, wait + inMovie, chunkOffsets[track], chunkSizes[track], wide);
            if (wait > 0) trak.Children!.Insert(trak.Children.FindIndex(c => c.Type == "tkhd") + 1, Edits(wait, inMovie));
            children.Add(trak);
        }
        var newMvhd = (byte[])mvhd.Clone();
        WriteDuration(newMvhd, newMvhd[0] == 1 ? 24 : 16, newMvhd[0] == 1, movieDuration);
        var at = children.FindIndex(c => c.Type == "mvhd");
        children[at] = new Box("mvhd", newMvhd, null);
        return new Box("moov", null, children);
    }

    private static Box RebuildTrak(Box trak, Track track, ulong mediaDuration, ulong inMovie, List<long> offsets,
        List<(int Count, uint Description)> chunks, bool wide)
    {
        Box Copy(Box box, Func<Box, Box?> change)
        {
            if (box.Children is null) return change(box) ?? box;
            var kids = new List<Box>();
            foreach (var c in box.Children)
            {
                var changed = change(c);
                if (changed is null && c.Children is null) continue;
                kids.Add(changed ?? Copy(c, change));
            }
            return new Box(box.Type, null, kids);
        }
        return Copy(trak, box => box.Type switch
        {
            "tkhd" => WithDuration(box, box.Payload![0] == 1 ? 28 : 20, inMovie),
            "mdhd" => WithDuration(box, box.Payload![0] == 1 ? 24 : 16, mediaDuration),
            "elst" => WholeEdit(box, inMovie),
            "stbl" => Stbl(box, track, offsets, chunks, wide),
            _ => box.Children is null ? box : null,
        });
    }

    /// <summary>An <c>edts</c> whose list waits <paramref name="wait"/> (movie time) with nothing
    /// shown, then plays the track from its start for <paramref name="length"/>.</summary>
    private static Box Edits(ulong wait, ulong length)
    {
        var wide = wait > uint.MaxValue || length > uint.MaxValue;
        var elst = FullBox("elst", (byte)(wide ? 1 : 0), w =>
        {
            w.U32(2);
            foreach (var (duration, mediaTime) in new[] { (wait, -1L), (length, 0L) })
            {
                if (wide) { w.U64(duration); w.U64(unchecked((ulong)mediaTime)); }
                else { w.U32((uint)duration); w.U32(unchecked((uint)(int)mediaTime)); }
                w.U32(0x00010000);
            }
        });
        return new Box("edts", null, [elst]);
    }

    private static Box WithDuration(Box box, int at, ulong value)
    {
        var p = (byte[])box.Payload!.Clone();
        WriteDuration(p, at, p[0] == 1, value);
        return new Box(box.Type, p, null);
    }

    private static void WriteDuration(byte[] p, int at, bool wide, ulong value)
    {
        if (wide) BinaryPrimitives.WriteUInt64BigEndian(p.AsSpan(at), value);
        else BinaryPrimitives.WriteUInt32BigEndian(p.AsSpan(at), (uint)Math.Min(value, uint.MaxValue));
    }

    /// <summary>An edit list's empty durations (a fragmented file's "the whole track") made the
    /// track's length.</summary>
    private static Box WholeEdit(Box box, ulong inMovie)
    {
        var p = (byte[])box.Payload!.Clone();
        var wide = p[0] == 1;
        var count = BinaryPrimitives.ReadUInt32BigEndian(p.AsSpan(4));
        var entry = wide ? 20 : 12;
        for (var i = 0; i < count && 8 + (i + 1) * entry <= p.Length; i++)
        {
            var at = 8 + i * entry;
            var duration = wide ? BinaryPrimitives.ReadUInt64BigEndian(p.AsSpan(at)) : BinaryPrimitives.ReadUInt32BigEndian(p.AsSpan(at));
            if (duration == 0) WriteDuration(p, at, wide, inMovie);
        }
        return new Box(box.Type, p, null);
    }

    private static Box Stbl(Box stbl, Track track, List<long> offsets, List<(int Count, uint Description)> chunks, bool wide)
    {
        var samples = track.Samples;
        var kids = new List<Box>();
        // The sample description is kept; every table is new. Sample groups refer to the old
        // fragments and are dropped.
        if (stbl.Child("stsd") is { } stsd) kids.Add(stsd);

        var stts = new List<(uint Count, uint Delta)>();
        foreach (var s in samples)
        {
            if (stts.Count > 0 && stts[^1].Delta == s.Duration) stts[^1] = (stts[^1].Count + 1, s.Duration);
            else stts.Add((1, s.Duration));
        }
        kids.Add(FullBox("stts", 0, w =>
        {
            w.U32((uint)stts.Count);
            foreach (var (count, delta) in stts) { w.U32(count); w.U32(delta); }
        }));

        if (samples.Any(s => s.CompositionOffset != 0))
        {
            var ctts = new List<(uint Count, int Offset)>();
            foreach (var s in samples)
            {
                if (ctts.Count > 0 && ctts[^1].Offset == s.CompositionOffset) ctts[^1] = (ctts[^1].Count + 1, s.CompositionOffset);
                else ctts.Add((1, s.CompositionOffset));
            }
            var negative = ctts.Any(c => c.Offset < 0);
            kids.Add(FullBox("ctts", (byte)(negative ? 1 : 0), w =>
            {
                w.U32((uint)ctts.Count);
                foreach (var (count, off) in ctts) { w.U32(count); w.U32(unchecked((uint)off)); }
            }));
        }

        if (samples.Any(s => !s.Sync))
        {
            var sync = samples.Select((s, i) => (s, i)).Where(x => x.s.Sync).Select(x => (uint)(x.i + 1)).ToList();
            kids.Add(FullBox("stss", 0, w =>
            {
                w.U32((uint)sync.Count);
                foreach (var n in sync) w.U32(n);
            }));
        }

        var stsc = new List<(uint FirstChunk, uint PerChunk, uint Description)>();
        for (var c = 0; c < chunks.Count; c++)
        {
            var (count, description) = chunks[c];
            if (stsc.Count > 0 && stsc[^1].PerChunk == count && stsc[^1].Description == description) continue;
            stsc.Add(((uint)(c + 1), (uint)count, description));
        }
        kids.Add(FullBox("stsc", 0, w =>
        {
            w.U32((uint)stsc.Count);
            foreach (var (firstChunk, perChunk, description) in stsc) { w.U32(firstChunk); w.U32(perChunk); w.U32(description); }
        }));

        kids.Add(FullBox("stsz", 0, w =>
        {
            w.U32(0);
            w.U32((uint)samples.Count);
            foreach (var s in samples) w.U32(s.Size);
        }));

        kids.Add(FullBox(wide ? "co64" : "stco", 0, w =>
        {
            w.U32((uint)offsets.Count);
            foreach (var o in offsets)
            {
                if (wide) w.U64((ulong)o);
                else w.U32(checked((uint)o));
            }
        }));
        return new Box("stbl", null, kids);
    }

    private sealed class Writer
    {
        public MemoryStream Stream { get; } = new();

        public void U32(uint v)
        {
            Span<byte> b = stackalloc byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(b, v);
            Stream.Write(b);
        }

        public void U64(ulong v)
        {
            Span<byte> b = stackalloc byte[8];
            BinaryPrimitives.WriteUInt64BigEndian(b, v);
            Stream.Write(b);
        }
    }

    private static Box FullBox(string type, byte version, Action<Writer> body)
    {
        var w = new Writer();
        w.U32((uint)version << 24);
        body(w);
        return new Box(type, w.Stream.ToArray(), null);
    }

    private static byte[] Serialize(Box box)
    {
        using var stream = new MemoryStream();
        Write(stream, box);
        return stream.ToArray();
    }

    private static void Write(Stream stream, Box box)
    {
        byte[] body;
        if (box.Children is { } children)
        {
            using var inner = new MemoryStream();
            foreach (var child in children) Write(inner, child);
            body = inner.ToArray();
        }
        else
        {
            body = box.Payload ?? [];
        }
        Span<byte> head = stackalloc byte[8];
        BinaryPrimitives.WriteUInt32BigEndian(head, checked((uint)(body.Length + 8)));
        Encoding.ASCII.GetBytes(box.Type, head[4..]);
        stream.Write(head);
        stream.Write(body);
    }
}
