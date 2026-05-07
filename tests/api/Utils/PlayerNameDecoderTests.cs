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
}
