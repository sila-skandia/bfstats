using NodaTime;

namespace api.ServerMedia.Models;

/// <summary>One thumbnail beside a server on bfstats.io's landing page
/// (features/dogfights-on-stats-pages): a Short, a shared replay or a recorded dogfight.
/// <see cref="Kind"/> is <c>short</c>, <c>replay</c> or <c>dogfight</c>, and <see cref="Id"/> is
/// what opens it: the Short's slug, the recording's slug, the fight's id. <see cref="ImageUrl"/>
/// is its own picture (a Short's poster, a replay's thumbnail), relative to the API's host, or
/// null, when the page draws the level's art. <see cref="At"/> is when it was shared (a fight's
/// recording date has no time, so null there).</summary>
public record ServerMediaItemDto(
    string Kind,
    string Id,
    string Title,
    string? ImageUrl,
    string Mod,
    string Level,
    double Seconds,
    Instant? At);
