using System.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace api.Telemetry;

/// <summary>
/// Middleware that enriches OpenTelemetry traces with request metadata including IP address,
/// user agent, browser detection, bot detection, and route categorization.
/// This ensures all traces have consistent metadata for querying in Tempo.
/// </summary>
public class RequestTelemetryMiddleware
{
    private readonly RequestDelegate _next;

    public RequestTelemetryMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var activity = Activity.Current;
        if (activity != null)
        {
            // Add user agent if not already present
            var userAgent = context.Request.Headers["User-Agent"].ToString();
            if (!string.IsNullOrEmpty(userAgent))
            {
                activity.SetTag("user_agent.original", userAgent);

                // Detect browser
                var browser = DetectBrowser(userAgent);
                if (!string.IsNullOrEmpty(browser))
                {
                    activity.SetTag("browser", browser);
                }

                // Detect if it's a bot
                var isBot = IsBot(userAgent);
                activity.SetTag("is_bot", isBot.ToString().ToLowerInvariant());
            }

            // Add IP address
            var ipAddress = GetClientIpAddress(context);
            if (!string.IsNullOrEmpty(ipAddress) && ipAddress != "unknown")
            {
                activity.SetTag("client_ip", ipAddress);
            }

            // Add request path
            var requestPath = context.Request.Path.Value;
            if (!string.IsNullOrEmpty(requestPath))
            {
                activity.SetTag("request_path", requestPath);

                // Categorize route type
                var routeType = CategorizeRoute(requestPath);
                if (!string.IsNullOrEmpty(routeType))
                {
                    activity.SetTag("route_type", routeType);
                }
            }

            // Add HTTP method
            var httpMethod = context.Request.Method;
            if (!string.IsNullOrEmpty(httpMethod))
            {
                activity.SetTag("http_method", httpMethod);
            }
        }

        await _next(context);
    }

    private string GetClientIpAddress(HttpContext httpContext)
    {
        // Check X-Forwarded-For header first (for reverse proxies)
        var forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrEmpty(forwardedFor))
        {
            // X-Forwarded-For can contain multiple IPs, take the first one
            return forwardedFor.Split(',')[0].Trim();
        }

        // Check X-Real-IP header
        var realIp = httpContext.Request.Headers["X-Real-IP"].FirstOrDefault();
        if (!string.IsNullOrEmpty(realIp))
        {
            return realIp;
        }

        // Fall back to connection remote IP
        return httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    private string DetectBrowser(string userAgent)
    {
        if (string.IsNullOrEmpty(userAgent))
            return "unknown";

        var ua = userAgent.ToLowerInvariant();

        if (ua.Contains("chrome") && !ua.Contains("edg"))
            return "Chrome";
        if (ua.Contains("firefox"))
            return "Firefox";
        if (ua.Contains("safari") && !ua.Contains("chrome"))
            return "Safari";
        if (ua.Contains("edg"))
            return "Edge";
        if (ua.Contains("opera") || ua.Contains("opr"))
            return "Opera";
        if (ua.Contains("msie") || ua.Contains("trident"))
            return "IE";

        return "Other";
    }

    private bool IsBot(string userAgent)
    {
        if (string.IsNullOrEmpty(userAgent))
            return false;

        var ua = userAgent.ToLowerInvariant();

        // Common bot/crawler patterns
        var botPatterns = new[]
        {
            "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
            "yandexbot", "sogou", "exabot", "facebot", "ia_archiver",
            "applebot", "twitterbot", "rogerbot", "linkedinbot", "embedly",
            "quora link preview", "showyoubot", "outbrain", "pinterest",
            "slackbot", "vkShare", "W3C_Validator", "whatsapp", "flipboard",
            "tumblr", "bitlybot", "skypeuripreview", "nuzzel", "discordbot",
            "qwantify", "pinterestbot", "bitrix link preview", "xing-contenttabreceiver",
            "chrome-lighthouse", "semrushbot", "ahrefsbot", "dotbot", "mj12bot",
            "petalbot", "crawler", "spider", "bot", "scraper"
        };

        return botPatterns.Any(pattern => ua.Contains(pattern));
    }

    private string CategorizeRoute(string requestPath)
    {
        if (string.IsNullOrEmpty(requestPath))
            return "unknown";

        var path = requestPath.ToLowerInvariant();

        // Page-view beacon from the SPA — counted via the PageView log event, not route_type.
        if (path.StartsWith("/stats/telemetry/page-view"))
            return "page_beacon";

        if (path.StartsWith("/health"))
            return "health";
        if (path.StartsWith("/swagger"))
            return "swagger";
        if (path.StartsWith("/hub"))
            return "signalr";

        // Everything else the API sees is an internal XHR from the SPA or an external API caller.
        // Page-view classification happens client-side; do not attempt to infer it from the URL here.
        if (path.StartsWith("/stats/") || path.StartsWith("/api/"))
            return "api_call";

        return "other";
    }
}
