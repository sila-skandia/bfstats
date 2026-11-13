using api.ImageStorage;
using api.PlayerBanners;
using api.PlayerBanners.Models;
using api.ServerBanners;
using api.ServerBanners.Models;
using api.Signatures;
using Microsoft.Extensions.Logging.Abstractions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.tests;

/// <summary>
/// The forum signatures (features/forum-signatures): every mod's every scene in the shipped
/// catalogue has its hero art, both layouts render at the widths the API allows, and the hero
/// is really drawn on the right. Set SIGNATURE_PREVIEW_DIR to keep the PNGs for a look.
/// </summary>
public sealed class BannerRenderTests
{
    private static readonly SignatureArtCatalogue Art = new();
    private static readonly SignatureCanvas Canvas = new(new BannerFonts(), new MapImageResolver(NullLogger<MapImageResolver>.Instance));

    private static readonly BannerStats Player = new("=NDR=Lapu", "MoonGamers.com | Est. 2004", 12345, 67890, 1.87, 432.5);

    private static readonly ServerBannerStats Server = new(
        "*NEW* SiMPLE | BF1942 | Conquest only | Est. 2003", "123.123.123.123:14567", "Berlin", "conquest", 48, 64, true,
        new ServerBannerTickets("AXIS", "ALLIES", 123, 87), "bf1942");

    private static readonly ServerBannerStats Offline = new("Quiet", "5.6.7.8:14567", null, null, 0, 32, false, null, "fhsw");

    [Fact]
    public void The_catalogue_ships_with_every_mod_and_its_art()
    {
        Assert.True(Art.Mods.Count >= 9, $"only {Art.Mods.Count} mods in the catalogue");
        foreach (var mod in Art.Mods)
        {
            Assert.NotEmpty(mod.Scenes);
            foreach (var scene in mod.Scenes)
            {
                var pick = Art.Pick(mod.Id, scene.Id);
                Assert.NotNull(pick);
                Assert.Equal(scene.Id, pick.Scene.Id);
                Assert.True(File.Exists(pick.HeroPath), $"{mod.Id}/{scene.Id} has no hero at {pick.HeroPath}");
            }
        }
    }

    [Fact]
    public void A_server_falls_back_to_its_own_mod_and_unknown_choices_to_the_defaults()
    {
        Assert.Equal("desertcombat", Art.Pick(null, null, "dc_final")!.Mod.Id);
        Assert.Equal("fhsw", Art.Pick(null, null, "fhsweurope")!.Mod.Id);
        Assert.Equal("gcmod", Art.Pick("GCMOD", "fighter")!.Mod.Id);
        var unknown = Art.Pick("nope", "nope", "nope")!;
        Assert.Equal(SignatureArtCatalogue.DefaultMod, unknown.Mod.Id);
        Assert.Equal(unknown.Mod.Scenes[0].Id, unknown.Scene.Id);
    }

    [Theory]
    [InlineData("tank", "armour")]
    [InlineData("PLANE", "fighter")]
    [InlineData("island", "bomber")]
    [InlineData("map", "assault")]
    [InlineData(null, null)]
    public void Old_style_links_keep_their_subject(string? style, string? scene) =>
        Assert.Equal(scene, PlayerBannerController.LegacyScene(style));

    public static TheoryData<string, string> Scenes()
    {
        var data = new TheoryData<string, string>();
        foreach (var mod in Art.Mods)
            foreach (var scene in mod.Scenes)
                data.Add(mod.Id, scene.Id);
        return data;
    }

    [Theory]
    [MemberData(nameof(Scenes))]
    public async Task Every_scene_draws_a_player_signature_with_the_hero_on_the_right(string mod, string scene)
    {
        var bytes = await new PlayerSignatureRenderer(Canvas).RenderAsync(Player, Art.Pick(mod, scene)!, SignatureCanvas.DefaultWidth);
        using var image = Image.Load<Rgba32>(bytes);
        Keep(bytes, $"player-{mod}-{scene}.png");
        Assert.Equal(SignatureCanvas.DesignWidth, image.Width);
        Assert.Equal(SignatureCanvas.DesignHeight, image.Height);
        // The hero side carries far more of the picture than the plain plate does.
        Assert.True(Colours(image, 0.62f, 1f) > 400, $"{mod}/{scene}: the hero side is nearly empty");
    }

    [Theory]
    [InlineData(SignatureCanvas.MinWidth)]
    [InlineData(SignatureCanvas.MaxWidth)]
    public async Task A_server_signature_is_a_png_of_the_width_asked_for(int width)
    {
        var renderer = new ServerSignatureRenderer(Canvas);
        foreach (var (stats, art) in new[] { (Server, Art.Pick(null, "armour", "bf1942")!), (Offline, Art.Pick(null, null, "fhsw")!) })
        {
            var bytes = await renderer.RenderAsync(stats, art, width);
            Keep(bytes, $"server-{art.Mod.Id}-{width}.png");
            using var image = Image.Load<Rgba32>(bytes);
            Assert.Equal(width, image.Width);
            Assert.Equal((int)MathF.Round(SignatureCanvas.DesignHeight * width / (float)SignatureCanvas.DesignWidth), image.Height);
            Assert.True(Colours(image, 0f, 0.6f) > 20, "the words side drew almost nothing");
        }
    }

    private static void Keep(byte[] bytes, string name)
    {
        var dir = Environment.GetEnvironmentVariable("SIGNATURE_PREVIEW_DIR");
        if (!string.IsNullOrEmpty(dir))
            File.WriteAllBytes(System.IO.Path.Combine(dir, name), bytes);
    }

    private static int Colours(Image<Rgba32> image, float from, float to)
    {
        var seen = new HashSet<Rgba32>();
        var x0 = (int)(image.Width * from);
        var x1 = (int)(image.Width * to);
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y += 3)
            {
                var row = rows.GetRowSpan(y);
                for (var x = x0; x < x1; x += 2) seen.Add(row[x]);
            }
        });
        return seen.Count;
    }
}
