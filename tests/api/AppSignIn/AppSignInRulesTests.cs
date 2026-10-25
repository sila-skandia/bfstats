using api.AppSignIn;

namespace api.tests.AppSignIn;

public sealed class AppSignInRulesTests
{
    [Theory]
    [InlineData("http://127.0.0.1:1024/callback")]
    [InlineData("http://127.0.0.1:53682/callback")]
    [InlineData("http://127.0.0.1:65535/callback")]
    [InlineData("http://localhost:8080/callback")]
    public void TheLoopbackCallback_IsAccepted(string uri) =>
        Assert.True(AppSignInRules.IsValidRedirectUri(uri));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("http://127.0.0.1.evil.com:8080/callback")]
    [InlineData("http://127.0.0.1:8080.evil.com/callback")]
    [InlineData("http://evil.com:8080/callback")]
    [InlineData("http://localhost.evil.com:8080/callback")]
    [InlineData("http://evil.localhost:8080/callback")]
    [InlineData("https://127.0.0.1:8080/callback")]
    [InlineData("HTTP://127.0.0.1:8080/callback")]
    [InlineData("http://LOCALHOST:8080/callback")]
    [InlineData("http://a@127.0.0.1:8080/callback")]
    [InlineData("http://127.0.0.1@evil.com:8080/callback")]
    [InlineData("http://127.0.0.1:8080@evil.com/callback")]
    [InlineData("http://[::1]:8080/callback")]
    [InlineData("http://0.0.0.0:8080/callback")]
    [InlineData("http://127.0.0.2:8080/callback")]
    [InlineData("http://2130706433:8080/callback")]
    [InlineData("http://127.0.0.1/callback")]
    [InlineData("http://127.0.0.1:80/callback")]
    [InlineData("http://127.0.0.1:1023/callback")]
    [InlineData("http://127.0.0.1:65536/callback")]
    [InlineData("http://127.0.0.1:99999/callback")]
    [InlineData("http://127.0.0.1:08080/callback")]
    [InlineData("http://127.0.0.1:8080")]
    [InlineData("http://127.0.0.1:8080/")]
    [InlineData("http://127.0.0.1:8080/callback/")]
    [InlineData("http://127.0.0.1:8080/Callback")]
    [InlineData("http://127.0.0.1:8080/callback/../steal")]
    [InlineData("http://127.0.0.1:8080/../callback")]
    [InlineData("http://127.0.0.1:8080/x/../callback")]
    [InlineData("http://127.0.0.1:8080/%63allback")]
    [InlineData("http://127.0.0.1:8080/callback?x=1")]
    [InlineData("http://127.0.0.1:8080/callback?")]
    [InlineData("http://127.0.0.1:8080/callback#frag")]
    [InlineData("http://127.0.0.1:8080/callback\n")]
    [InlineData(" http://127.0.0.1:8080/callback")]
    [InlineData("http://127.0.0.1:8080\\callback")]
    [InlineData("//127.0.0.1:8080/callback")]
    [InlineData("http:/127.0.0.1:8080/callback")]
    public void AnythingElse_IsRefused(string? uri) =>
        Assert.False(AppSignInRules.IsValidRedirectUri(uri));

    [Fact]
    public void OnlyTheSidecar_IsAKnownClient()
    {
        Assert.True(AppSignInRules.IsKnownClient("bfstats-sidecar"));
        Assert.False(AppSignInRules.IsKnownClient("BFSTATS-SIDECAR"));
        Assert.False(AppSignInRules.IsKnownClient("other"));
        Assert.False(AppSignInRules.IsKnownClient(null));
    }

    [Theory]
    [InlineData("abc", true)]
    [InlineData("Zx9_-.~", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("a b", false)]
    [InlineData("a&b=c", false)]
    [InlineData("a#b", false)]
    public void State_IsUrlSafe(string? state, bool valid) =>
        Assert.Equal(valid, AppSignInRules.IsValidState(state));

    [Fact]
    public void State_IsAtMost256()
    {
        Assert.True(AppSignInRules.IsValidState(new string('a', 256)));
        Assert.False(AppSignInRules.IsValidState(new string('a', 257)));
    }

    [Fact]
    public void TheRfc7636Example_Verifies()
    {
        // RFC 7636 appendix B.
        const string verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        const string challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        Assert.Equal(challenge, AppSignInRules.ChallengeFor(verifier));
        Assert.True(AppSignInRules.IsValidChallenge(challenge));
        Assert.True(AppSignInRules.IsValidVerifier(verifier));
        Assert.True(AppSignInRules.VerifierMatches(verifier, challenge));
        Assert.False(AppSignInRules.VerifierMatches(verifier[..^1] + "Y", challenge));
    }

    [Theory]
    [InlineData(null, "Unnamed device")]
    [InlineData("   ", "Unnamed device")]
    [InlineData("  DESKTOP-42  ", "DESKTOP-42")]
    [InlineData("my\u0000pc\r\nhome", "mypchome")]
    [InlineData("a   b", "a b")]
    public void Device_IsCleaned(string? device, string shown) =>
        Assert.Equal(shown, AppSignInRules.NormalizeDevice(device));

    [Fact]
    public void Device_IsCutTo64()
    {
        Assert.Equal(64, AppSignInRules.NormalizeDevice(new string('x', 200)).Length);
    }

    [Fact]
    public void Codes_AreRandom_AndHashedStably()
    {
        var a = AppSignInRules.NewCode();
        var b = AppSignInRules.NewCode();
        Assert.NotEqual(a, b);
        Assert.Equal(43, a.Length);
        Assert.Equal(AppSignInRules.HashCode(a), AppSignInRules.HashCode(a));
        Assert.NotEqual(a, AppSignInRules.HashCode(a));
    }
}
