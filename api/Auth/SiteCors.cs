namespace api.Auth;

/// <summary>
/// The CORS policy for sites hosted for someone else that sign their visitors in with bfstats
/// accounts (bfv.bfstats.io, features/bfv-through-bfstats), from <c>Cors:SiteOrigins</c>.
/// <para>
/// Never credentialed, and never the default policy's list: bfv.bfstats.io is the same site as
/// bfstats.io for SameSite=Lax, so a browser would send it bfstats.io's refresh cookie on a
/// credentialed request, and its script could read back a full sign-in. A site's token comes
/// from the app sign-in hand-off and travels in the Authorization header instead.
/// </para>
/// Only on the endpoints such a site calls: the hand-off's token, refresh and revoke, and
/// sharing and managing a recording.
/// </summary>
public static class SiteCors
{
    public const string Policy = "sites";
    public const string OriginsKey = "Cors:SiteOrigins";
}
