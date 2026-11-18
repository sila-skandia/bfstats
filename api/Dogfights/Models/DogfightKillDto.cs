namespace api.Dogfights.Models;

/// <summary>The kill that ended a fight: by which side (0 or 1), when (seconds into the
/// fight), and with what.</summary>
public record DogfightKillDto(int Side, double T, string? Weapon);
