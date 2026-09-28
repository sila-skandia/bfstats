using System.Text;

namespace api.Utils;

public static class PlayerNameDecoder
{
    private static readonly Encoding Cp1252;
    private static readonly Encoding Cp1251;

    static PlayerNameDecoder()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Cp1252 = Encoding.GetEncoding(1252);
        Cp1251 = Encoding.GetEncoding(1251);
    }

    /// <summary>
    /// A name as a bf42plus recording writes it, each byte as the character of the same number
    /// (U+0000 to U+00FF), in the form BFList hands bfstats the same bytes: read as cp1252. The
    /// two differ only at 0x80 to 0x9F, where cp1252 keeps its symbols (0x95 is a bullet, 0x99
    /// a trade mark) and the recording has control characters. For looking a recorded name up
    /// among the players; a name that did not come from a recording passes unchanged.
    /// </summary>
    public static string FromRecording(string name)
    {
        if (!name.Any(c => c is >= '\u0080' and <= '\u009F')) return name;
        var chars = name.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is >= '\u0080' and <= '\u009F') chars[i] = Cp1252.GetString([(byte)chars[i]])[0];
        }
        return new string(chars);
    }

    public static string Decode(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return raw ?? "";

        var bytes = Cp1252.GetBytes(raw);
        var latin = 0;
        var nonLatin = 0;
        foreach (var b in bytes)
        {
            if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) latin++;
            else if (b >= 192 && b <= 255) nonLatin++;
        }

        var total = latin + nonLatin;
        if (total == 0) return raw;

        return nonLatin / (double)total >= 0.8
            ? Cp1251.GetString(bytes)
            : raw;
    }
}
