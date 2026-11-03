namespace api.Shorts.Models;

/// <summary>An upload's outcome: the Short, and whether this upload made it (false when its
/// kill was clipped already).</summary>
public sealed record ShortUploadResult(ShortDto Short, bool Created);
