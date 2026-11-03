using api.Recordings;

namespace api.Shorts;

/// <summary>
/// Where Shorts live: <c>shorts/&lt;slug&gt;.mp4</c> and <c>shorts/&lt;slug&gt;.jpg</c> under the
/// recordings directory, so they share its volume, its <c>.incoming/</c> (a rename puts one in
/// place) and its room checks.
/// </summary>
public sealed class ShortStorage(IRecordingStorage recordings)
{
    public string Directory => Path.Combine(recordings.Root, "shorts");

    public string VideoPath(string slug) => Path.Combine(Directory, $"{Checked(slug)}.mp4");

    public string PosterPath(string slug) => Path.Combine(Directory, $"{Checked(slug)}.jpg");

    public string IncomingPath() => recordings.IncomingPath();

    public string? RoomFor(long storedBytes, long incomingBytes) => recordings.RoomFor(storedBytes, incomingBytes);

    /// <summary>Moves an upload into place, over nothing: a slug is never reused.</summary>
    public void Promote(string incomingPath, string finalPath)
    {
        System.IO.Directory.CreateDirectory(Directory);
        recordings.Promote(incomingPath, finalPath);
    }

    /// <summary>Removes a Short's files. Missing ones are not an error.</summary>
    public void Delete(string slug)
    {
        File.Delete(VideoPath(slug));
        File.Delete(PosterPath(slug));
    }

    private static string Checked(string slug) =>
        RecordingStorage.CleanSlug(slug) ?? throw new ArgumentException("not a Short's slug", nameof(slug));
}
