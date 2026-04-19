using System.Reflection;
using SixLabors.Fonts;

namespace api.PlayerBanners;

/// <summary>
/// Loads the embedded display fonts once and exposes scaled <see cref="Font"/> instances.
/// </summary>
public sealed class BannerFonts
{
    private readonly FontFamily _display;
    private readonly FontFamily _label;

    public BannerFonts()
    {
        var collection = new FontCollection();
        var assembly = Assembly.GetExecutingAssembly();

        _display = LoadEmbedded(collection, assembly, "api.PlayerBanners.Resources.Roboto-Bold.ttf");
        _label = LoadEmbedded(collection, assembly, "api.PlayerBanners.Resources.Roboto-Medium.ttf");
    }

    public Font Display(float size) => _display.CreateFont(size, FontStyle.Regular);
    public Font Label(float size) => _label.CreateFont(size, FontStyle.Bold);

    private static FontFamily LoadEmbedded(FontCollection collection, Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded font resource not found: {resourceName}");
        return collection.Add(stream);
    }
}
