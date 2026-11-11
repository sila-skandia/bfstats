namespace api.Shorts.Models;

/// <summary>One Short a retention run took down, or would.</summary>
public sealed record PrunedShortDto(string Slug, string Kind, double AgeDays, int Views);
