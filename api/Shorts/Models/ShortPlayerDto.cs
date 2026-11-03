namespace api.Shorts.Models;

/// <summary>A player in the week's Shorts, and how many of them he is in.</summary>
public sealed record ShortPlayerDto(string Name, int Shorts, int AsKiller);
