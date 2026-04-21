namespace api.Telemetry.Models;

public record PageViewRequest(
    string PageType,
    string? Slug,
    string VisitorId,
    string SessionId,
    string? Referrer,
    string? RouteName,
    string? Path);
