namespace api.Bflist.Models;

/// <summary>
/// A cached poll of the upstream BFList server list, with the time it was actually fetched.
/// IsFallback is never itself cached — it's set on the copy returned when the read path
/// serves last-known-good because the hot cache is empty (and the snapshot is older than
/// the landing page's freshness window).
/// </summary>
public class RawServerSnapshot
{
    public DateTime FetchedAtUtc { get; set; }
    public Bf1942ServerInfo[] Servers { get; set; } = [];
    public bool IsFallback { get; set; }
}
