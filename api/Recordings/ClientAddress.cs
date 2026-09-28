using Microsoft.AspNetCore.Http;

namespace api.Recordings;

/// <summary>
/// The visitor's address. Requests reach the API through Cloudflare's tunnel and HAProxy,
/// so the connection's own address is HAProxy's for everyone: Cloudflare's
/// <c>CF-Connecting-IP</c> names the visitor, then the first <c>X-Forwarded-For</c> hop.
/// For rate limits and view counting only, never for anything that trusts it.
/// </summary>
public static class ClientAddress
{
    public static string Of(HttpContext context)
    {
        var cloudflare = context.Request.Headers["CF-Connecting-IP"].ToString().Trim();
        if (cloudflare.Length > 0) return cloudflare;
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
        var first = forwarded.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
        return first ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
