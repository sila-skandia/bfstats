namespace api.Dogfights.Models;

/// <summary>How a fight ended (features/dogfight-recordings, rule 8): <c>shot down</c>,
/// <c>downed by another</c>, <c>died</c>, <c>left his plane</c>, <c>out of range</c>,
/// <c>apart</c> or <c>quiet</c>; when (seconds into the fight), to which side, and, downed by
/// a third, by whom.</summary>
public record DogfightEndDto(string Why, double? T, int? Side, DogfightThirdDto? By = null);
