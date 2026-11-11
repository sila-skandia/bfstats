namespace api.Shorts.Models;

/// <summary>What a retention run took down (or, on a dry run, would), and the chunked-upload
/// parts it swept.</summary>
public sealed record ShortPruneDto(bool DryRun, IReadOnlyList<PrunedShortDto> Pruned, int PartsSwept);
