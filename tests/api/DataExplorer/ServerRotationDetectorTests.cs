using api.DataExplorer;

namespace api.tests.DataExplorer;

public class ServerRotationDetectorTests
{
    [Fact]
    public void Detect_ReturnsTrailingRepeatedRotation()
    {
        var rounds = BuildRounds(
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"));

        var detected = ServerRotationDetector.Detect(rounds);

        Assert.NotNull(detected);
        Assert.Equal(3, detected.CycleLength);
        Assert.Equal(
            ["wake", "el alamein", "tobruk"],
            detected.Rotation.Select(item => item.MapName).ToArray());
        Assert.Equal(
            ["conquest", "ctf", "conquest"],
            detected.Rotation.Select(item => item.GameType).ToArray());
        Assert.True(detected.Rotation[^1].IsCurrent);
        Assert.True(detected.Confidence >= 0.7);
        Assert.True(detected.MatchedRecentRounds >= 9);
        Assert.False(detected.RecentlyChanged);
    }

    [Fact]
    public void Detect_FlagsRecentAdditionsAndRemovals()
    {
        var rounds = BuildRounds(
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("berlin", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("berlin", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("berlin", "conquest"),
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("berlin", "conquest"));

        var detected = ServerRotationDetector.Detect(rounds);

        Assert.NotNull(detected);
        Assert.True(detected.RecentlyChanged);
        Assert.Contains(detected.RecentlyAdded, item => item.MapName == "berlin" && item.GameType == "conquest");
        Assert.Contains(detected.RecentlyRemoved, item => item.MapName == "tobruk" && item.GameType == "conquest");
        Assert.Equal(
            ["wake", "el alamein", "berlin"],
            detected.Rotation.Select(item => item.MapName).ToArray());
    }

    [Fact]
    public void Detect_ReturnsNull_WhenThereIsNotEnoughHistory()
    {
        var rounds = BuildRounds(
            ("wake", "conquest"),
            ("el alamein", "ctf"),
            ("tobruk", "conquest"));

        var detected = ServerRotationDetector.Detect(rounds);

        Assert.Null(detected);
    }

    private static List<ServerRotationDetector.RotationRoundSample> BuildRounds(params (string MapName, string GameType)[] entries)
    {
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        return entries
            .Select((entry, index) => new ServerRotationDetector.RotationRoundSample(
                entry.MapName,
                entry.GameType,
                start.AddMinutes(index * 20)))
            .ToList();
    }
}
