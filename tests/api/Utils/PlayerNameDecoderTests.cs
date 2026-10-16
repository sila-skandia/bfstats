using api.Utils;

namespace api.tests.Utils;

public class PlayerNameDecoderTests
{
    [Fact]
    public void Decode_CyrillicMojibake_RoundTripsToCyrillic()
    {
        var decoded = PlayerNameDecoder.Decode("ÿ ëó÷øèé èãðîê áô");
        Assert.Equal("я лучший игрок бф", decoded);
    }

    [Fact]
    public void Decode_CyrillicVertoletik_RoundTripsToCyrillic()
    {
        var decoded = PlayerNameDecoder.Decode("Âåðòîëåòèê");
        Assert.Equal("Вертолетик", decoded);
    }

    [Fact]
    public void Decode_PureLatinName_ReturnsUnchanged()
    {
        Assert.Equal("Dylan", PlayerNameDecoder.Decode("Dylan"));
    }

    [Fact]
    public void Decode_MostlyLatinBelowThreshold_ReturnsUnchanged()
    {
        // 5 latin + 1 non-latin = 16% non-latin, well below the 80% cutoff
        const string mixed = "Dylanÿ";
        Assert.Equal(mixed, PlayerNameDecoder.Decode(mixed));
    }

    [Fact]
    public void Decode_ShortCyrillicOnly_RoundTrips()
    {
        // "áô" → "бф"
        Assert.Equal("бф", PlayerNameDecoder.Decode("áô"));
    }

    [Fact]
    public void Decode_Empty_ReturnsEmpty()
    {
        Assert.Equal("", PlayerNameDecoder.Decode(""));
    }

    [Fact]
    public void Decode_Null_ReturnsEmpty()
    {
        Assert.Equal("", PlayerNameDecoder.Decode(null));
    }

    [Fact]
    public void Decode_OnlyDigitsAndPunctuation_ReturnsUnchanged()
    {
        // No latin or cyrillic bytes — total counter is 0, return as-is
        Assert.Equal("12345!", PlayerNameDecoder.Decode("12345!"));
    }

    /// <summary>A recording writes a name's bytes as U+0000 to U+00FF; BFList hands bfstats the
    /// same bytes read as cp1252. They differ only at 0x80 to 0x9F.</summary>
    [Theory]
    [InlineData("skandia", "skandia")]
    [InlineData("=\u0095NDR\u0095=Lapu", "=\u2022NDR\u2022=Lapu")]
    [InlineData("Sgt\u0099", "Sgt\u2122")]
    [InlineData("\u0080uro", "\u20ACuro")]
    [InlineData("=\u2022NDR\u2022=Lapu", "=\u2022NDR\u2022=Lapu")]
    [InlineData("Âàíÿ", "Âàíÿ")]
    public void FromRecording_ReadsARecordedNamesBytesAsBflistDoes(string recorded, string site) =>
        Assert.Equal(site, PlayerNameDecoder.FromRecording(recorded));
    [Theory]
    [InlineData("skandia", "skandia")]
    [InlineData("=\u2022NDR\u2022=Lapu", "=\u0095NDR\u0095=Lapu")]
    [InlineData("Sgt\u2122", "Sgt\u0099")]
    [InlineData("\u20ACuro", "\u0080uro")]
    [InlineData("\u00C2\u00E0\u00ED\u00FF", "\u00C2\u00E0\u00ED\u00FF")]
    // Not in cp1252 at all: left as it is.
    [InlineData("\u4E2D", "\u4E2D")]
    public void ToRecording_WritesASiteNameAsARecordingWould(string site, string recorded)
    {
        Assert.Equal(recorded, PlayerNameDecoder.ToRecording(site));
        Assert.Equal(site, PlayerNameDecoder.FromRecording(recorded));
    }
}
