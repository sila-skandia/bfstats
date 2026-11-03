namespace api.Shorts.Models;

/// <summary>The kills already clipped from one recording, by key.</summary>
public sealed record ShortKeysDto(IReadOnlyList<string> Keys);
