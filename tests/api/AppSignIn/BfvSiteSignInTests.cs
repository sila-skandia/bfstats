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
/// bfv.bfstats.io's sign-in (features/bfv-through-bfstats): the app hand-off for a site hosted
/// for someone else. It may only be sent back to its own callback, and the token it holds in
/// its pages' script is short-lived, a plain user's and carries no email.
/// </summary>
// The admin email is process-wide: run beside AppRolesTests, never with it.
[Collection("AppRolesTests")]
public sealed class BfvSiteSignInTests
{
    [Theory]
    [InlineData("https://bfv.bfstats.io/auth/callback")]
    [InlineData("http://localhost:5283/auth/callback")]
    [InlineData("http://127.0.0.1:8080/auth/callback")]
    public void BfvSite_IsSentBackToItsOwnCallbackOrALocalBfvPage(string uri) =>
        Assert.True(AppSignInRules.IsValidRedirectUri(AppSignInRules.BfvSiteClient, uri));

    [Theory]
    [InlineData("http://bfv.bfstats.io/auth/callback")] // not https
    [InlineData("https://bfv.bfstats.io/auth/callback/")]
    [InlineData("https://bfv.bfstats.io/auth/callback?next=/")]
    [InlineData("https://bfv.bfstats.io/auth/callback#x")]
    [InlineData("https://BFV.bfstats.io/auth/callback")]
    [InlineData("https://bfv.bfstats.io.evil.example/auth/callback")]
    [InlineData("https://evil.example/auth/callback")]
    [InlineData("https://bfstats.io/auth/callback")]
    [InlineData("http://localhost:5283/callback")] // the relay's listener, not a bfv page
    [InlineData("http://localhost:80/auth/callback")]
    [InlineData("http://192.168.1.4:5283/auth/callback")]
    [InlineData(null)]
    public void BfvSite_IsSentNowhereElse(string? uri) =>
        Assert.False(AppSignInRules.IsValidRedirectUri(AppSignInRules.BfvSiteClient, uri));

    [Fact]
    public void Relay_IsNotSentToBfvsCallback()
    {
        Assert.False(AppSignInRules.IsValidRedirectUri(AppSignInRules.RelayClient, AppSignInRules.BfvSiteRedirectUri));
        Assert.True(AppSignInRules.IsValidRedirectUri(AppSignInRules.RelayClient, "http://127.0.0.1:53682/callback"));
        Assert.False(AppSignInRules.IsValidRedirectUri("someone-else", AppSignInRules.BfvSiteRedirectUri));
    }

    [Fact]
    public void BfvSite_IsAKnownClient() => Assert.True(AppSignInRules.IsKnownClient(AppSignInRules.BfvSiteClient));

    [Fact]
    public void BfvSiteToken_IsAPlainUsersForMinutesWithNoEmail_EvenForTheAdmin()
    {
        var before = AppRoles.AdminEmail;
        AppRoles.Configure("admin@example.com");
        try
        {
            var tokens = Tokens();
            var admin = new User { Id = 7, Email = "admin@example.com", Role = AppRoles.Support };
            var now = DateTime.UtcNow;

            var (raw, expires) = tokens.CreateAppAccessToken(admin, AppSignInRules.BfvSiteClient);
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(raw);

            Assert.InRange(expires, now.AddMinutes(14), now.AddMinutes(16));
            Assert.Equal([AppRoles.User], jwt.Claims.Where(c => c.Type is ClaimTypes.Role or "role").Select(c => c.Value).Distinct());
            Assert.DoesNotContain(jwt.Claims, c => c.Type is ClaimTypes.Email or JwtRegisteredClaimNames.Email || c.Value == admin.Email);
            Assert.Equal(AppSignInRules.BfvSiteClient, jwt.Claims.Single(c => c.Type == TokenService.ClientClaim).Value);
            Assert.Equal("7", jwt.Claims.Single(c => c.Type == ClaimTypes.NameIdentifier).Value);
            Assert.False(AppRoles.HasAdminEmail(new ClaimsPrincipal(new ClaimsIdentity(jwt.Claims))));
        }
        finally
        {
            AppRoles.Configure(before);
        }
    }

    [Fact]
    public void SiteToken_LeavesBfstatsOwnTokensAsTheyWere()
    {
        var before = AppRoles.AdminEmail;
        AppRoles.Configure("admin@example.com");
        try
        {
            var tokens = Tokens();
            var admin = new User { Id = 7, Email = "admin@example.com" };

            var (site, _) = tokens.CreateAccessToken(admin);
            var (relay, relayExpires) = tokens.CreateAppAccessToken(admin, AppSignInRules.RelayClient);

            var siteJwt = new JwtSecurityTokenHandler().ReadJwtToken(site);
            Assert.Contains(siteJwt.Claims, c => c.Type == ClaimTypes.Role && c.Value == AppRoles.Admin);
            Assert.Contains(siteJwt.Claims, c => c.Type == ClaimTypes.Email && c.Value == admin.Email);
            Assert.DoesNotContain(siteJwt.Claims, c => c.Type == TokenService.ClientClaim);
            Assert.True(relayExpires > DateTime.UtcNow.AddDays(6));
            Assert.Equal(AppSignInRules.RelayClient, new JwtSecurityTokenHandler().ReadJwtToken(relay).Claims.Single(c => c.Type == TokenService.ClientClaim).Value);
        }
        finally
        {
            AppRoles.Configure(before);
        }
    }

    [Theory]
    [InlineData("bfv", SignUpSites.Bfv)]
    [InlineData(" BFV ", SignUpSites.Bfv)]
    [InlineData(null, SignUpSites.Bfstats)]
    [InlineData("bfstats", SignUpSites.Bfstats)]
    [InlineData("anything", SignUpSites.Bfstats)]
    public void SignUpSite_IsBfvOnlyWhenTheSignUpSaysSo(string? via, string expected) =>
        Assert.Equal(expected, SignUpSites.From(via));

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
