namespace api.ServerMedia.Models;

/// <summary>A server's media on the landing page: the few thumbnails it shows, and how many
/// Shorts, replays and dogfights there are in all. <see cref="ServerName"/> is the site's form of
/// the name, as the server list has it.</summary>
public record ServerMediaDto(
    string ServerName,
    int Shorts,
    int Replays,
    int Dogfights,
    IReadOnlyList<ServerMediaItemDto> Items);
