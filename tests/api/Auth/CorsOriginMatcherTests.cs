using api.Auth;

namespace api.tests.Auth;

public class CorsOriginMatcherTests
{
    [Fact]
    public void Parse_SplitsCommaSeparatedOrigins()
    {
        var origins = CorsOriginMatcher.Parse("https://bfstats.io, https://staging.bfstats.io");

        Assert.Equal(["https://bfstats.io", "https://staging.bfstats.io"], origins);
    }

    [Fact]
    public void Parse_Empty_ReturnsNoOrigins()
    {
        Assert.Empty(CorsOriginMatcher.Parse(null));
        Assert.Empty(CorsOriginMatcher.Parse(""));
        Assert.Empty(CorsOriginMatcher.Parse("  "));
    }

    [Fact]
    public void IsAllowed_Unconfigured_AllowsAnyOrigin()
    {
        Assert.True(CorsOriginMatcher.IsAllowed(null, "https://evil.example", null, "bfstats.io"));
    }

    [Fact]
    public void IsAllowed_ExactConfiguredOrigin()
    {
        Assert.True(CorsOriginMatcher.IsAllowed(
            "https://bfstats.io,https://staging.bfstats.io",
            "https://bfstats.io",
            null,
            "api.internal"));
    }

    [Fact]
    public void IsAllowed_SameHost_WhenCorsConfigIsStale()
    {
        Assert.True(CorsOriginMatcher.IsAllowed(
            "https://1942.munyard.dev",
            "https://bfstats.io",
            null,
            "bfstats.io"));
    }

    [Fact]
    public void IsAllowed_RefererPrefix()
    {
        Assert.True(CorsOriginMatcher.IsAllowed(
            "https://bfstats.io",
            null,
            "https://bfstats.io/players/skandia",
            "api.internal"));
    }

    [Fact]
    public void IsAllowed_RejectsCrossOriginMismatch()
    {
        Assert.False(CorsOriginMatcher.IsAllowed(
            "https://bfstats.io",
            "https://evil.example",
            "https://evil.example/logout",
            "bfstats.io"));
    }
}
