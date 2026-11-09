using System.Text.Json;

namespace api.Recordings.Models;

/// <summary>A shared edit: its <paramref name="Code"/>, the recording it is of
/// (<paramref name="Slug"/>), who shared it and when (ISO 8601), the studio's
/// <paramref name="Edit"/>, and its <paramref name="Link"/>, the recording's short link that
/// opens it.</summary>
public sealed record RecordingEditDto(
    string Code, string Slug, string Name, string AuthorName, string CreatedAt, JsonElement Edit, string Link);
