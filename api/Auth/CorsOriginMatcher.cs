namespace api.Auth;

internal static class CorsOriginMatcher
{
    public static string[] Parse(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured))
            return [];

        return configured.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    public static bool IsAllowed(string? configured, string? origin, string? referer, string? requestHost)
    {
        var allowed = Parse(configured);
        if (allowed.Length == 0)
            return true;

        if (!string.IsNullOrEmpty(origin))
        {
            if (allowed.Any(a => string.Equals(origin, a, StringComparison.OrdinalIgnoreCase)))
                return true;

            // TLS is terminated at the edge, so Request.Scheme is often http while
            // the browser Origin is https. CSRF is cross-origin; matching hosts is enough.
            if (Uri.TryCreate(origin, UriKind.Absolute, out var originUri)
                && !string.IsNullOrEmpty(requestHost)
                && string.Equals(originUri.Host, requestHost, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        if (!string.IsNullOrEmpty(referer)
            && allowed.Any(a => referer.StartsWith(a, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return false;
    }
}
