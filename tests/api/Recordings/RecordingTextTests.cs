using api.Recordings;

namespace api.tests.Recordings;

public class RecordingTextTests
{
    [Theory]
    [InlineData("0:21 get rekt", 21.0)]
    [InlineData("that tank at 12:05 though", 725.0)]
    [InlineData("1:02:03 the flag goes", 3723.0)]
    [InlineData("watch 9:59 then 0:10", 599.0)]
    public void FirstTime_ReadsATimeInTheComment(string text, double seconds) =>
        Assert.Equal(seconds, RecordingText.FirstTime(text, durationSeconds: 3800));

    [Theory]
    [InlineData("no time here")]
    [InlineData("score was 12:3")]
    [InlineData("the 20:61 thing")]
    [InlineData("1:2:03")]
    public void FirstTime_IgnoresWhatIsNotATime(string text) =>
        Assert.Null(RecordingText.FirstTime(text, durationSeconds: 3800));

    [Fact]
    public void FirstTime_SkipsATimePastTheEnd() =>
        Assert.Equal(30.0, RecordingText.FirstTime("at 59:00 and 0:30", durationSeconds: 600));

    [Fact]
    public void Line_FoldsNewlinesAndDropsControlsAndBidiOverrides() =>
        Assert.Equal("Midway at dawn", RecordingText.Line("  Midway\n\u202Eat\u0007 dawn\t ", 100));

    [Fact]
    public void Line_CutsAtTheLimit() => Assert.Equal("abc", RecordingText.Line("abcdef", 3));

    [Fact]
    public void Comment_KeepsLinesButNotRunsOfBlankOnes() =>
        Assert.Equal("one\n\ntwo", RecordingText.Comment("one\r\n\n\n\n\ntwo\n"));

    [Theory]
    [InlineData("Midway", "midway")]
    [InlineData("xpack1", "xpack1")]
    [InlineData("../etc", "")]
    [InlineData("a b", "")]
    public void Id_TakesOnlyAViewerIdentifier(string value, string id) => Assert.Equal(id, RecordingText.Id(value));

    [Fact]
    public void Titled_WordsALevelFolder() => Assert.Equal("El Alamein", RecordingText.Titled("el_alamein"));
}
