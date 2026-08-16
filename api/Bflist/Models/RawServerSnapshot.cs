namespace api.Bflist.Models;

/// <summary>
/// A cached poll of the upstream BFList server list, with the time it was actually fetched.
/// IsFallback is never itself cached — it's set on the copy returned when a live fetch fails
/// and a last-known-good snapshot is served in its place.
/// </summary>
public class RawServerSnapshot
{
    public DateTime FetchedAtUtc { get; set; }
    public Bf1942ServerInfo[] Servers { get; set; } = [];
    public bool IsFallback { get; set; }
}
