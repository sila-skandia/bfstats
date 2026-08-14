using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace api.Caching;

/// <summary>
/// Lets Cloudflare absorb the traffic for an endpoint while keeping the browser honest.
/// </summary>
/// <remarks>
/// <para>
/// <c>[ResponseCache(Location = Any)]</c> emits <c>public, max-age=N</c>, and
/// <c>max-age</c> binds every cache in the chain — the browser's included. Inside that
/// window an SPA route change is answered from disk with no request at all, so a user
/// who revisits a page they opened five minutes ago sees the old payload until they
/// reload. That is what this attribute exists to avoid.
/// </para>
/// <para>
/// <c>s-maxage</c> applies to shared caches only. The edge still serves the repeat
/// traffic, while <c>max-age=0</c> means the browser asks every time — so freshness is
/// bounded by the edge TTL rather than by when the user last pressed F5. The zone-wide
/// Cloudflare rule is set to "use cache-control header if present", which prefers
/// <c>s-maxage</c> over <c>max-age</c>; see features/perf-latency-au/README.md.
/// </para>
/// <para>
/// Use this for endpoints whose data visibly moves. Where a stale copy is harmless,
/// <c>[ResponseCache]</c> is still the better trade — it saves the round trip entirely.
/// </para>
/// </remarks>
/// <param name="seconds">How long a shared cache may serve the response without revalidating.</param>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class EdgeCacheAttribute(int seconds) : Attribute, IResultFilter
{
    /// <summary>
    /// How long past <c>s-maxage</c> the edge may serve the stale copy while it
    /// refreshes in the background, keeping the refresh off the visitor's critical path.
    /// </summary>
    public int StaleWhileRevalidate { get; init; } = 60;

    public void OnResultExecuting(ResultExecutingContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // The status code usually still lives on the result at this point — it is only
        // copied onto the response when the result executes — so read it from there
        // first. Caching a 404 or a 500 would outlive the condition that produced it.
        var statusCode = (context.Result as IStatusCodeActionResult)?.StatusCode
                         ?? context.HttpContext.Response.StatusCode;

        if (statusCode is < 200 or >= 300)
            return;

        context.HttpContext.Response.Headers.CacheControl =
            $"public, max-age=0, s-maxage={seconds}, stale-while-revalidate={StaleWhileRevalidate}";
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
    }
}
