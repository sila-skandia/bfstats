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
