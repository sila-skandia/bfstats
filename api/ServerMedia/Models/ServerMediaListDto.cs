namespace api.ServerMedia.Models;

/// <summary>Every server with something to show, busiest first.</summary>
public record ServerMediaListDto(IReadOnlyList<ServerMediaDto> Servers);
