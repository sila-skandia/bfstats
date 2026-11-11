namespace api.Shorts.Models;

/// <summary>One part of a chunked upload, received: its upload id, index and size.</summary>
public sealed record ShortPartDto(string Upload, int Index, long Bytes);
