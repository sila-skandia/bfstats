using System.Text.Json;

namespace api.Recordings.Models;

/// <summary>An edit to share: its <paramref name="Name"/>, the studio's <paramref name="Edit"/>
/// (a JSON object), and the linked player name to share it as (the account's first when
/// left out).</summary>
public sealed record ShareRecordingEditRequest(string? Name, JsonElement Edit, string? AuthorName = null);
