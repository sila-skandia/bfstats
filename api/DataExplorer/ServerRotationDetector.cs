using api.DataExplorer.Models;

namespace api.DataExplorer;

public static class ServerRotationDetector
{
    public static ServerRotationInsightDto? Detect(
        IReadOnlyCollection<RotationRoundSample> rounds,
        int maxPatternLength = 12)
    {
        var orderedRounds = rounds
            .Where(r => !string.IsNullOrWhiteSpace(r.MapName))
            .OrderBy(r => r.StartTime)
            .ToList();

        if (orderedRounds.Count < 4)
            return null;

        var sequence = orderedRounds
            .Select(r => new RotationSlot(r.MapName.Trim(), r.GameType.Trim()))
            .ToList();

        RotationCandidate? bestCandidate = null;
        var maxLength = Math.Min(maxPatternLength, Math.Max(1, sequence.Count / 2));

        for (var patternLength = 1; patternLength <= maxLength; patternLength++)
        {
            var pattern = sequence.TakeLast(patternLength).ToList();

            if (HasRepeatedSubPattern(pattern))
                continue;

            var matchedRounds = CountTrailingMatches(sequence, pattern);
            var minimumMatches = Math.Max(6, patternLength * 2);

            if (matchedRounds < minimumMatches)
                continue;

            var fullCycles = matchedRounds / patternLength;
            var score = (fullCycles * 1000) + (matchedRounds * 10) - patternLength;

            if (bestCandidate is null || score > bestCandidate.Score)
            {
                bestCandidate = new RotationCandidate(pattern, matchedRounds, fullCycles, score);
            }
        }

        if (bestCandidate is null)
            return null;

        var recentWindowSize = Math.Min(sequence.Count, Math.Max(bestCandidate.Pattern.Count * 3, 12));
        var recentDistinct = sequence
            .TakeLast(recentWindowSize)
            .Distinct()
            .ToList();

        var previousWindowStart = Math.Max(0, sequence.Count - (recentWindowSize * 2));
        var previousWindowCount = Math.Min(recentWindowSize, Math.Max(0, sequence.Count - recentWindowSize - previousWindowStart));
        var previousDistinct = previousWindowCount == 0
            ? []
            : sequence
                .Skip(previousWindowStart)
                .Take(previousWindowCount)
                .Distinct()
                .ToList();

        var (recentlyAdded, recentlyRemoved) = previousDistinct.Count == 0
            ? (new List<RotationChangeItemDto>(), new List<RotationChangeItemDto>())
            : GetRotationChanges(recentDistinct, previousDistinct);

        var confidence = CalculateConfidence(bestCandidate, sequence.Count);
        var rotation = bestCandidate.Pattern
            .Select((slot, index) => new DetectedRotationItemDto(
                Position: index + 1,
                MapName: slot.MapName,
                GameType: slot.GameType,
                IsCurrent: index == bestCandidate.Pattern.Count - 1))
            .ToList();

        return new ServerRotationInsightDto(
            Rotation: rotation,
            Confidence: confidence,
            MatchedRecentRounds: bestCandidate.MatchedRounds,
            SampleSize: sequence.Count,
            CycleLength: bestCandidate.Pattern.Count,
            RecentlyChanged: recentlyAdded.Count > 0 || recentlyRemoved.Count > 0,
            RecentlyAdded: recentlyAdded,
            RecentlyRemoved: recentlyRemoved
        );
    }

    private static bool HasRepeatedSubPattern(IReadOnlyList<RotationSlot> pattern)
    {
        for (var subLength = 1; subLength < pattern.Count; subLength++)
        {
            if (pattern.Count % subLength != 0)
                continue;

            var candidate = pattern.Take(subLength).ToList();
            var isMatch = true;

            for (var index = 0; index < pattern.Count; index++)
            {
                if (pattern[index] != candidate[index % subLength])
                {
                    isMatch = false;
                    break;
                }
            }

            if (isMatch)
                return true;
        }

        return false;
    }

    private static int CountTrailingMatches(IReadOnlyList<RotationSlot> sequence, IReadOnlyList<RotationSlot> pattern)
    {
        var matchedRounds = 0;
        var patternStartIndex = sequence.Count - pattern.Count;

        for (var sequenceIndex = sequence.Count - 1; sequenceIndex >= 0; sequenceIndex--)
        {
            var expected = pattern[(sequenceIndex - patternStartIndex).Mod(pattern.Count)];

            if (sequence[sequenceIndex] != expected)
                break;

            matchedRounds++;
        }

        return matchedRounds;
    }

    private static double CalculateConfidence(RotationCandidate candidate, int sampleSize)
    {
        var cycleCoverage = Math.Min(1.0, (double)candidate.FullCycles / 3.0);
        var tailCoverage = Math.Min(1.0, (double)candidate.MatchedRounds / Math.Max(12, sampleSize));
        var sampleCoverage = Math.Min(1.0, (double)sampleSize / 36.0);

        return Math.Round((cycleCoverage * 0.5) + (tailCoverage * 0.3) + (sampleCoverage * 0.2), 2);
    }

    private static (List<RotationChangeItemDto> Added, List<RotationChangeItemDto> Removed) GetRotationChanges(
        IReadOnlyCollection<RotationSlot> recentDistinct,
        IReadOnlyCollection<RotationSlot> previousDistinct)
    {
        var previousSet = previousDistinct.ToHashSet();
        var recentSet = recentDistinct.ToHashSet();

        var added = recentDistinct
            .Where(slot => !previousSet.Contains(slot))
            .Select(slot => new RotationChangeItemDto(slot.MapName, slot.GameType))
            .ToList();

        var removed = previousDistinct
            .Where(slot => !recentSet.Contains(slot))
            .Select(slot => new RotationChangeItemDto(slot.MapName, slot.GameType))
            .ToList();

        return (added, removed);
    }

    public record RotationRoundSample(
        string MapName,
        string GameType,
        DateTime StartTime
    );

    private sealed record RotationCandidate(
        IReadOnlyList<RotationSlot> Pattern,
        int MatchedRounds,
        int FullCycles,
        int Score
    );

    private sealed record RotationSlot(
        string MapName,
        string GameType
    );
}

file static class IntegerExtensions
{
    public static int Mod(this int value, int divisor) =>
        ((value % divisor) + divisor) % divisor;
}
