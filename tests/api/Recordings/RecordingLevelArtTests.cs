using System.Net;
using api.Recordings;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace api.tests.Recordings;

/// <summary>The picture a link preview shows for a recording with no cover: the level's
/// loading screen, found the way the viewer's own chain finds it (level-art.js).</summary>
public sealed class RecordingLevelArtTests : IDisposable
{
    private const string Play = "https://play.bfstats.io";

    private readonly MemoryCache cache = new(new MemoryCacheOptions());
    private readonly Site site = new();
    private readonly RecordingLevelArt art;

    public RecordingLevelArtTests()
    {
        var http = Substitute.For<IHttpClientFactory>();
        http.CreateClient(RecordingLevelArt.HttpClientName).Returns(_ => new HttpClient(site, disposeHandler: false));
        art = new RecordingLevelArt(
            Options.Create(new RecordingsOptions()), cache, http, NullLogger<RecordingLevelArt>.Instance);
    }

    public void Dispose()
    {
        cache.Dispose();
        site.Dispose();
    }

    [Fact]
    public async Task TheLevelsOwnRowInItsModsTree()
    {
        site.Json["/maps/mods/fhsweurope/maps.json"] =
            """[{"name":"Battle_of_Pavlov-1942","loading":{"background":"_shared/load/pavlov.webp"}}]""";
        site.Files.Add("/maps/mods/fhsweurope/_shared/load/pavlov.webp");

        var url = await art.UrlAsync("fhsweurope", "battle_of_pavlov-1942", default);

        Assert.Equal($"{Play}/maps/mods/fhsweurope/_shared/load/pavlov.webp", url);
    }

    /// <summary>A pack's level a server reported as <c>bf1942</c> is in the pack's tree, and a
    /// level a mod inherits shows vanilla's picture.</summary>
    [Theory]
    [InlineData("bf1942", "/maps/mods/xpack2/maps.json", "/maps/mods/xpack2/hellendoorn/load.webp")]
    [InlineData("fhsw", "/maps/maps.json", "/maps/hellendoorn/load.webp")]
    public async Task TheSameLevelInTheVanillaGamesTrees(string mod, string list, string file)
    {
        site.Json[list] = """[{"name":"Hellendoorn","loading":{"background":"hellendoorn/load.webp"}}]""";
        site.Files.Add(file);

        Assert.Equal(Play + file, await art.UrlAsync(mod, "hellendoorn", default));
    }

    /// <summary>A row can name a file a re-bake took away: the next picture that is there is
    /// the one handed out, down to the theatre picture every tree carries.</summary>
    [Fact]
    public async Task AFileThatIsGone_IsPassedOver()
    {
        site.Json["/maps/mods/fhsw/maps.json"] = """[{"name":"kursk","loading":{"background":"kursk/load.webp"}}]""";
        site.Files.Add("/maps/_shared/load/western.webp");

        Assert.Equal($"{Play}/maps/_shared/load/western.webp", await art.UrlAsync("fhsw", "Kursk", default));
    }

    /// <summary>Nothing found, or the play site not answering, is no picture and not an
    /// error; and what was found is not asked for again.</summary>
    [Fact]
    public async Task NoPicture_IsNull_AndAnAnswerIsKept()
    {
        Assert.Null(await art.UrlAsync("bf1942", "nowhere", default));
        site.Fails = true;
        Assert.Null(await art.UrlAsync("xpack1", "anzio", default));
        site.Fails = false;

        site.Json["/maps/mods/eod/maps.json"] = """[{"name":"hue","loading":{"background":"hue/load.webp"}}]""";
        site.Files.Add("/maps/mods/eod/hue/load.webp");
        var first = await art.UrlAsync("eod", "hue", default);
        var asked = site.Requests;
        var second = await art.UrlAsync("eod", "HUE", default);

        Assert.Equal($"{Play}/maps/mods/eod/hue/load.webp", first);
        Assert.Equal(first, second);
        Assert.Equal(asked, site.Requests);
    }

    /// <summary>A mod or a level that is not a name asks the play site for nothing.</summary>
    [Theory]
    [InlineData("../../etc", "wake")]
    [InlineData("fhsw/..", "wake")]
    [InlineData("", "wake")]
    [InlineData("bf1942", "")]
    public async Task WhatIsNotAName_AsksForNothing(string mod, string level)
    {
        Assert.Null(await art.UrlAsync(mod, level, default));
        Assert.Equal(0, site.Requests);
    }

    /// <summary>Only a picture inside the tree is taken from a row: what it names goes into a
    /// page's tags.</summary>
    [Fact]
    public void Backgrounds_KeepOnlyPathsInsideTheTree()
    {
        var rows = RecordingLevelArt.Backgrounds("""
            [
              {"name":"Wake","loading":{"background":"wake/load.webp"}},
              {"name":"away","loading":{"background":"https://elsewhere.example/x.webp"}},
              {"name":"up","loading":{"background":"../../stats/x.webp"}},
              {"name":"quote","loading":{"background":"a\"><script>.webp"}},
              {"name":"script","loading":{"background":"wake/load.js"}},
              {"name":"none"},
              {"name":"bare","loading":{}},
              "not a row"
            ]
            """);

        Assert.Equal(["wake"], rows.Keys);
        Assert.Equal("wake/load.webp", rows["wake"]);
        Assert.Empty(RecordingLevelArt.Backgrounds("""{"maps":[]}"""));
    }

    [Fact]
    public void Trees_AreTheModsThenTheVanillaGames()
    {
        Assert.Equal(["bf1942", "xpack1", "xpack2"], RecordingLevelArt.Trees("bf1942"));
        Assert.Equal(["xpack2", "bf1942", "xpack1"], RecordingLevelArt.Trees("xpack2"));
        Assert.Equal(["fhsw", "bf1942"], RecordingLevelArt.Trees("fhsw"));
        Assert.Equal("/maps", RecordingLevelArt.TreePath("bf1942"));
        Assert.Equal("/maps/mods/fhsw", RecordingLevelArt.TreePath("fhsw"));
    }

    /// <summary>The play site, as far as this reads it: each tree's list and the files there.</summary>
    private sealed class Site : HttpMessageHandler
    {
        public Dictionary<string, string> Json { get; } = [];

        public HashSet<string> Files { get; } = [];

        public bool Fails { get; set; }

        public int Requests { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests++;
            if (Fails) throw new HttpRequestException("the play site is not answering");
            Assert.Equal("play.bfstats.io", request.RequestUri!.Host);
            var path = request.RequestUri.AbsolutePath;
            if (request.Method == HttpMethod.Get && Json.TryGetValue(path, out var json))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
            }
            return Task.FromResult(new HttpResponseMessage(
                request.Method == HttpMethod.Head && Files.Contains(path) ? HttpStatusCode.OK : HttpStatusCode.NotFound));
        }
    }
}
