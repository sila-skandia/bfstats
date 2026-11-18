namespace api.Dogfights.Models;

/// <summary>One pilot of a fight: his name as the recording has it, his team, the plane's
/// template, his aimed rounds and hits, how far he turned (degrees), and his gunners' rounds.</summary>
public record DogfightSideDto(string Name, int Team, string? Tmpl, int Aimed, int Hits, double Turned, int? Gunner = null);
