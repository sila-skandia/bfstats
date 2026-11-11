using System.Globalization;
using System.Text.RegularExpressions;
using api.Recordings;

namespace api.Shorts;

/// <summary>
/// Where Shorts live: <c>shorts/&lt;slug&gt;.mp4</c>, an optional HD copy <c>shorts/&lt;slug&gt;.hd.mp4</c>, and <c>shorts/&lt;slug&gt;.jpg</c> under the
/// recordings directory, so they share its volume, its <c>.incoming/</c> (a rename puts one in
/// place) and its room checks.
/// </summary>
public sealed partial class ShortStorage(IRecordingStorage recordings)
{
    /// <summary>A chunked upload's parts (<c>POST /stats/shorts/parts</c>), <c>&lt;id&gt;.&lt;n&gt;.part</c>.
    /// A folder of their own under <c>.incoming/</c>: the recordings' sweep takes a loose
    /// <c>.part</c> there after two hours, and a roll's parts are given a day.</summary>
    public string PartsDirectory => Path.Combine(recordings.Root, ".incoming", "shorts-parts");

    /// <summary>Whether <paramref name="id"/> is a chunked upload's id: 16 to 32 of a-z, 0-9.</summary>
    public static bool IsUploadId(string? id) => id is not null && UploadId().IsMatch(id);

    public string PartPath(string id, int index) => IsUploadId(id) && index >= 0
        ? Path.Combine(PartsDirectory, string.Create(CultureInfo.InvariantCulture, $"{id}.{index}.part"))
        : throw new ArgumentException("not a chunked upload's part");

    /// <summary>An upload's parts on disk, in index order.</summary>
    public List<(int Index, string Path)> Parts(string id)
    {
        if (!IsUploadId(id) || !System.IO.Directory.Exists(PartsDirectory)) return [];
        return [.. System.IO.Directory.EnumerateFiles(PartsDirectory, $"{id}.*.part")
            .Select(path => (Name: System.IO.Path.GetFileName(path), Path: path))
            .Select(f => (Ok: int.TryParse(f.Name[(id.Length + 1)..^".part".Length], NumberStyles.None,
                CultureInfo.InvariantCulture, out var index), Index: index, f.Path))
            .Where(f => f.Ok)
            .Select(f => (f.Index, f.Path))
            .OrderBy(f => f.Index)];
    }

    /// <summary>The bytes every unfinished chunked upload holds, for the room check.</summary>
    public long PendingPartBytes() => System.IO.Directory.Exists(PartsDirectory)
        ? System.IO.Directory.EnumerateFiles(PartsDirectory, "*.part").Sum(f => new FileInfo(f).Length)
        : 0;

    /// <summary>Moves a received part into place; one sent again replaces the last try.</summary>
    public void PlacePart(string incomingPath, string id, int index)
    {
        System.IO.Directory.CreateDirectory(PartsDirectory);
        File.Move(incomingPath, PartPath(id, index), overwrite: true);
    }

    /// <summary>Removes every part of the uploads begun more than <paramref name="olderThan"/>
    /// ago (by their oldest part) and never joined. The number of parts removed.</summary>
    public int SweepStaleParts(TimeSpan olderThan)
    {
        if (!System.IO.Directory.Exists(PartsDirectory)) return 0;
        var before = DateTime.UtcNow - olderThan;
        var removed = 0;
        var uploads = System.IO.Directory.EnumerateFiles(PartsDirectory, "*.part")
            .GroupBy(f => System.IO.Path.GetFileName(f).Split('.')[0]);
        foreach (var upload in uploads)
        {
            if (upload.Min(File.GetLastWriteTimeUtc) >= before) continue;
            foreach (var file in upload)
            {
                try
                {
                    File.Delete(file);
                    removed++;
                }
                catch (IOException)
                {
                }
            }
        }
        return removed;
    }

    public string Directory => Path.Combine(recordings.Root, "shorts");

    public string VideoPath(string slug) => Path.Combine(Directory, $"{Checked(slug)}.mp4");

    public string HdVideoPath(string slug) => Path.Combine(Directory, $"{Checked(slug)}.hd.mp4");

    public string PosterPath(string slug) => Path.Combine(Directory, $"{Checked(slug)}.jpg");

    public string IncomingPath() => recordings.IncomingPath();

    public string? RoomFor(long storedBytes, long incomingBytes) => recordings.RoomFor(storedBytes, incomingBytes);

    /// <summary>Moves an upload into place, over nothing: a slug is never reused.</summary>
    public void Promote(string incomingPath, string finalPath)
    {
        System.IO.Directory.CreateDirectory(Directory);
        recordings.Promote(incomingPath, finalPath);
    }

    /// <summary>Puts a new poster in place of the old one.</summary>
    public void ReplacePoster(string incomingPath, string slug) => File.Move(incomingPath, PosterPath(slug), overwrite: true);

    /// <summary>Removes a Short's files. Missing ones are not an error.</summary>
    public void Delete(string slug)
    {
        File.Delete(VideoPath(slug));
        File.Delete(HdVideoPath(slug));
        File.Delete(PosterPath(slug));
    }

    [GeneratedRegex("^[a-z0-9]{16,32}$")]
    private static partial Regex UploadId();

    private static string Checked(string slug) =>
        RecordingStorage.CleanSlug(slug) ?? throw new ArgumentException("not a Short's slug", nameof(slug));
}
