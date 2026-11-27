using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using api.AppSignIn;
using api.Auth;
using api.Authorization;
using api.PlayerTracking;
using Microsoft.Extensions.Configuration;

namespace api.tests.AppSignIn;

/// <summary>
/// The Replay Shorts job's sign-in (features/replay-shorts, "Signing in"): the relay's loopback
/// hand-off under its own client name, so it shows as itself in Signed-in apps, and a token that
/// carries the account's own role, the way the render job writes as an admin.
/// </summary>
// The admin email is process-wide: run beside AppRolesTests, never with it.
[Collection("AppRolesTests")]
public sealed class ShortsSignInTests
{
    [Fact]
    public void ShortsJob_IsAKnownClient() => Assert.True(AppSignInRules.IsKnownClient(AppSignInRules.ShortsClient));

    [Theory]
    [InlineData("http://127.0.0.1:53682/callback")]
    [InlineData("http://localhost:1024/callback")]
    public void ShortsJob_IsSentBackToItsLoopbackListener(string uri) =>
        Assert.True(AppSignInRules.IsValidRedirectUri(AppSignInRules.ShortsClient, uri));

    [Theory]
    [InlineData(AppSignInRules.BfvSiteRedirectUri)]
    [InlineData("http://localhost:5283/auth/callback")]
    [InlineData("https://bfstats.io/callback")]
    [InlineData("http://192.168.1.4:53682/callback")]
    [InlineData("http://127.0.0.1:80/callback")]
    [InlineData(null)]
    public void ShortsJob_IsSentNowhereElse(string? uri) =>
        Assert.False(AppSignInRules.IsValidRedirectUri(AppSignInRules.ShortsClient, uri));

    [Theory]
    [InlineData(AppRoles.Admin)]
    [InlineData(AppRoles.BfvAdmin)]
    [InlineData(AppRoles.User)]
    public void ShortsJobToken_CarriesTheAccountsOwnRole(string role)
    {
        var tokens = Tokens();
        var account = new User { Id = 11, Email = "render@example.com", Role = role };

        var (raw, expires) = tokens.CreateAppAccessToken(account, AppSignInRules.ShortsClient);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(raw);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(jwt.Claims, "test", ClaimTypes.Name, ClaimTypes.Role));

        Assert.Equal(role == AppRoles.Admin, principal.IsInRole(AppRoles.Admin));
        Assert.Contains(jwt.Claims, c => c.Type == ClaimTypes.Role && c.Value == role);
        Assert.Equal(AppSignInRules.ShortsClient, jwt.Claims.Single(c => c.Type == TokenService.ClientClaim).Value);
        // A night's filming and a long 4K upload fit inside one token.
        Assert.True(expires > DateTime.UtcNow.AddDays(6));
    }

    [Fact]
    public void ShortsJobToken_OfTheAdminAddress_IsAnAdmins()
    {
        var before = AppRoles.AdminEmail;
        AppRoles.Configure("admin@example.com");
        try
        {
            var (raw, _) = Tokens().CreateAppAccessToken(new User { Id = 7, Email = "admin@example.com" }, AppSignInRules.ShortsClient);
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(raw);
            Assert.Contains(jwt.Claims, c => c.Type == ClaimTypes.Role && c.Value == AppRoles.Admin);
        }
        finally
        {
            AppRoles.Configure(before);
        }
    }

    private static TokenService Tokens()
    {
        using var rsa = RSA.Create(2048);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:PrivateKey"] = rsa.ExportRSAPrivateKeyPem(),
                ["Jwt:Issuer"] = "bfstats-test",
                ["Jwt:Audience"] = "bfstats-test",
            })
            .Build();
        return new TokenService(config);
    }
}
