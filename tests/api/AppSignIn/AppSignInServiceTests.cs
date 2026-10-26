using api.AppSignIn;
using api.AppSignIn.Models;
using api.Auth;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using NSubstitute;

namespace api.tests.AppSignIn;

/// <summary>The app sign-in end to end against SQLite, with the real refresh token machinery.</summary>
public sealed class AppSignInServiceTests : IDisposable
{
    private sealed class FixedClock : IClock
    {
        public Instant Now { get; set; } = SystemClock.Instance.GetCurrentInstant();
        public Instant GetCurrentInstant() => Now;
    }

    private const string Redirect = "http://127.0.0.1:53682/callback";
    private const string Verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    private const string Challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext db;
    private readonly FixedClock clock = new();
    private readonly RefreshTokenService refreshTokens;
    private readonly AppSignInService service;

    public AppSignInServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RefreshToken:Secret"] = "test-secret-for-app-sign-in" })
            .Build();
        refreshTokens = new RefreshTokenService(db, config, NullLogger<RefreshTokenService>.Instance);

        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddDays(7)));

        service = new AppSignInService(db, refreshTokens, tokens, clock, NullLogger<AppSignInService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        connection.Dispose();
    }

    private async Task<User> CreateUserAsync(string email = "player@example.com", string? username = null)
    {
        var user = new User { Email = email, Username = username, CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static AuthorizeAppRequest Request(
        string? client = AppSignInRules.SidecarClient,
        string? redirect = Redirect,
        string? challenge = Challenge,
        string? method = "S256",
        string? state = "st4te",
        string? device = "DESKTOP-42") =>
        new(client, device, redirect, state, challenge, method);

    private async Task<string> CodeAsync(int userId, AuthorizeAppRequest? request = null)
    {
        var result = await service.AuthorizeAsync(userId, request ?? Request());
        Assert.Equal(AppSignInOutcome.Ok, result.Outcome);
        Assert.Equal(Redirect, result.Value!.RedirectUri);
        return result.Value.Code;
    }

    private Task<AppSignInResult<AppTokenResponse>> ExchangeAsync(string code, string verifier = Verifier, string redirect = Redirect) =>
        service.ExchangeAsync(new AppTokenRequest(code, verifier, redirect), "203.0.113.9", "bfstats-sidecar/1.0");

    private async Task<AppTokenResponse> SignInAsync(User user)
    {
        var result = await ExchangeAsync(await CodeAsync(user.Id));
        Assert.Equal(AppSignInOutcome.Ok, result.Outcome);
        return result.Value!;
    }

    [Fact]
    public async Task HappyPath_IssuesAnAccessTokenAndAMarkedRefreshToken()
    {
        var user = await CreateUserAsync(username: "skandia");

        var answer = await SignInAsync(user);

        Assert.Equal($"access-for-{user.Id}", answer.AccessToken);
        Assert.Equal(new AppTokenUser(user.Id, "skandia"), answer.User);
        Assert.True(answer.RefreshExpiresAt > clock.Now + Duration.FromDays(59));
        var row = await db.RefreshTokens.AsNoTracking().SingleAsync();
        Assert.Equal("bfstats-sidecar", row.Client);
        Assert.Equal("DESKTOP-42", row.Device);
        Assert.NotNull(row.FamilyId);
        Assert.Equal("203.0.113.9", row.IpAddress);
        Assert.DoesNotContain(answer.RefreshToken, row.TokenHash);
    }

    [Fact]
    public async Task TheCode_IsStoredOnlyAsAHash()
    {
        var user = await CreateUserAsync();
        var code = await CodeAsync(user.Id);

        var row = await db.AppAuthorizationCodes.AsNoTracking().SingleAsync();
        Assert.NotEqual(code, row.CodeHash);
        Assert.Equal(AppSignInRules.HashCode(code), row.CodeHash);
        Assert.Equal(clock.Now + Duration.FromMinutes(2), row.ExpiresAt);
        Assert.Equal(user.Id, row.UserId);
        Assert.Equal(Challenge, row.CodeChallenge);
    }

    [Theory]
    [InlineData("other-app", Redirect, Challenge, "S256", "st")]
    [InlineData(null, Redirect, Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "http://127.0.0.1.evil.com:8080/callback", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "https://127.0.0.1:8080/callback", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "http://a@127.0.0.1:8080/callback", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "http://127.0.0.1:8080/callback/../x", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "http://127.0.0.1:8080/callback?next=evil", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", "http://127.0.0.1:80/callback", Challenge, "S256", "st")]
    [InlineData("bfstats-sidecar", Redirect, Challenge, "plain", "st")]
    [InlineData("bfstats-sidecar", Redirect, Challenge, null, "st")]
    [InlineData("bfstats-sidecar", Redirect, "short", "S256", "st")]
    [InlineData("bfstats-sidecar", Redirect, Challenge, "S256", "")]
    [InlineData("bfstats-sidecar", Redirect, Challenge, "S256", "a&b")]
    public async Task Authorize_RefusesWhatTheRulesRefuse(string? client, string? redirect, string? challenge, string? method, string? state)
    {
        var user = await CreateUserAsync();

        var result = await service.AuthorizeAsync(user.Id, Request(client, redirect, challenge, method, state));

        Assert.Equal(AppSignInOutcome.InvalidRequest, result.Outcome);
        Assert.Equal("invalid_request", result.Error);
        Assert.Empty(await db.AppAuthorizationCodes.ToListAsync());
    }

    [Fact]
    public async Task Authorize_ForAnErasedAccount_IsRefused()
    {
        var user = await CreateUserAsync();
        user.Email = $"deleted-user-{user.Id}@deleted.invalid";
        await db.SaveChangesAsync();

        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.AuthorizeAsync(user.Id, Request())).Outcome);
    }

    [Fact]
    public async Task AWrongVerifier_IsInvalidGrant_AndSpendsTheCode()
    {
        var user = await CreateUserAsync();
        var code = await CodeAsync(user.Id);

        var wrong = await ExchangeAsync(code, verifier: new string('A', 43));
        var right = await ExchangeAsync(code);

        Assert.Equal(AppSignInOutcome.InvalidGrant, wrong.Outcome);
        Assert.Equal("invalid_grant", wrong.Error);
        Assert.Equal(AppSignInOutcome.InvalidGrant, right.Outcome);
        Assert.Empty(await db.RefreshTokens.ToListAsync());
    }

    [Fact]
    public async Task AMalformedVerifier_IsInvalidGrant()
    {
        var user = await CreateUserAsync();
        Assert.Equal(AppSignInOutcome.InvalidGrant, (await ExchangeAsync(await CodeAsync(user.Id), verifier: "short")).Outcome);
    }

    [Fact]
    public async Task AReusedCode_IsInvalidGrant_AndRevokesWhatItIssued()
    {
        var user = await CreateUserAsync();
        var code = await CodeAsync(user.Id);
        var first = await ExchangeAsync(code);
        Assert.Equal(AppSignInOutcome.Ok, first.Outcome);

        var second = await ExchangeAsync(code);

        Assert.Equal(AppSignInOutcome.InvalidGrant, second.Outcome);
        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(first.Value!.RefreshToken, null, null)).Outcome);
        Assert.Empty(await service.ListSessionsAsync(user.Id));
    }

    [Fact]
    public async Task AnExpiredCode_IsInvalidGrant()
    {
        var user = await CreateUserAsync();
        var code = await CodeAsync(user.Id);

        clock.Now += Duration.FromMinutes(2);

        Assert.Equal(AppSignInOutcome.InvalidGrant, (await ExchangeAsync(code)).Outcome);
    }

    [Fact]
    public async Task ACodeJustInsideTwoMinutes_Works()
    {
        var user = await CreateUserAsync();
        var code = await CodeAsync(user.Id);

        clock.Now += Duration.FromSeconds(119);

        Assert.Equal(AppSignInOutcome.Ok, (await ExchangeAsync(code)).Outcome);
    }

    [Theory]
    [InlineData("http://127.0.0.1:53683/callback")]
    [InlineData("http://localhost:53682/callback")]
    [InlineData("http://127.0.0.1:53682/callback/")]
    public async Task AMismatchedRedirect_IsInvalidGrant(string redirect)
    {
        var user = await CreateUserAsync();

        Assert.Equal(AppSignInOutcome.InvalidGrant, (await ExchangeAsync(await CodeAsync(user.Id), redirect: redirect)).Outcome);
    }

    [Fact]
    public async Task AnUnknownCode_IsInvalidGrant_AndAnEmptyOneInvalidRequest()
    {
        Assert.Equal(AppSignInOutcome.InvalidGrant, (await ExchangeAsync("not-a-code")).Outcome);
        Assert.Equal(AppSignInOutcome.InvalidRequest,
            (await service.ExchangeAsync(new AppTokenRequest("", Verifier, Redirect), null, null)).Outcome);
    }

    [Fact]
    public async Task Authorize_ClearsTheUsersSpentAndLapsedCodes()
    {
        var user = await CreateUserAsync();
        var spent = await CodeAsync(user.Id);
        await ExchangeAsync(spent);
        await CodeAsync(user.Id); // lapses below
        clock.Now += Duration.FromMinutes(5);

        await CodeAsync(user.Id);

        Assert.Single(await db.AppAuthorizationCodes.ToListAsync());
    }

    [Fact]
    public async Task Refresh_Rotates_AndKeepsTheSignIn()
    {
        var user = await CreateUserAsync();
        var signIn = await SignInAsync(user);

        var refreshed = await service.RefreshAsync(signIn.RefreshToken, "198.51.100.1", "ua");

        Assert.Equal(AppSignInOutcome.Ok, refreshed.Outcome);
        Assert.NotEqual(signIn.RefreshToken, refreshed.Value!.RefreshToken);
        var rows = await db.RefreshTokens.AsNoTracking().ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Single(rows.Select(r => r.FamilyId).Distinct());
        Assert.All(rows, r => Assert.Equal("bfstats-sidecar", r.Client));
        Assert.All(rows, r => Assert.Equal("DESKTOP-42", r.Device));
        Assert.Single(await service.ListSessionsAsync(user.Id));

        // The new one refreshes in turn.
        Assert.Equal(AppSignInOutcome.Ok, (await service.RefreshAsync(refreshed.Value.RefreshToken, null, null)).Outcome);
    }

    [Fact]
    public async Task ReplayingARotatedToken_RevokesTheWholeFamily()
    {
        var user = await CreateUserAsync();
        var signIn = await SignInAsync(user);
        var refreshed = await service.RefreshAsync(signIn.RefreshToken, null, null);

        var replay = await service.RefreshAsync(signIn.RefreshToken, null, null);

        Assert.Equal(AppSignInOutcome.Unauthorized, replay.Outcome);
        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(refreshed.Value!.RefreshToken, null, null)).Outcome);
        Assert.Empty(await service.ListSessionsAsync(user.Id));
    }

    [Fact]
    public async Task Revoke_SignsTheAppOut()
    {
        var user = await CreateUserAsync();
        var signIn = await SignInAsync(user);
        var refreshed = (await service.RefreshAsync(signIn.RefreshToken, null, null)).Value!;

        await service.RevokeAsync(refreshed.RefreshToken);

        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(refreshed.RefreshToken, null, null)).Outcome);
        Assert.Empty(await service.ListSessionsAsync(user.Id));
        Assert.All(await db.RefreshTokens.AsNoTracking().ToListAsync(), r => Assert.NotNull(r.RevokedAt));
    }

    [Fact]
    public async Task Revoke_IgnoresUnknownAndCookieTokens()
    {
        var user = await CreateUserAsync();
        var (cookieRaw, _) = await refreshTokens.CreateAsync(user, null, null);

        await service.RevokeAsync("unknown");
        await service.RevokeAsync(null);
        await service.RevokeAsync(cookieRaw);

        Assert.Null((await db.RefreshTokens.AsNoTracking().SingleAsync()).RevokedAt);
    }

    [Fact]
    public async Task Sessions_AreEachUsersOwn_AndDeleteOnlyTouchesTheirs()
    {
        var alice = await CreateUserAsync("alice@example.com");
        var bob = await CreateUserAsync("bob@example.com");
        var aliceApp = await SignInAsync(alice);
        await SignInAsync(alice);
        var bobApp = await SignInAsync(bob);
        await refreshTokens.CreateAsync(alice, null, null); // her browser: not an app

        var aliceSessions = await service.ListSessionsAsync(alice.Id);
        var bobSessions = await service.ListSessionsAsync(bob.Id);
        Assert.Equal(2, aliceSessions.Count);
        Assert.Single(bobSessions);
        Assert.All(aliceSessions, s => Assert.Equal("DESKTOP-42", s.Device));

        // Bob cannot sign out Alice's app.
        Assert.False(await service.RevokeSessionAsync(bob.Id, aliceSessions[0].Id));
        Assert.Equal(2, (await service.ListSessionsAsync(alice.Id)).Count);

        var aliceFamily = (await db.RefreshTokens.AsNoTracking().FirstAsync(t => t.UserId == alice.Id && t.Client != null)).FamilyId!.Value;
        Assert.True(await service.RevokeSessionAsync(alice.Id, aliceFamily));
        Assert.Single(await service.ListSessionsAsync(alice.Id));
        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(aliceApp.RefreshToken, null, null)).Outcome);
        Assert.Equal(AppSignInOutcome.Ok, (await service.RefreshAsync(bobApp.RefreshToken, null, null)).Outcome);
        Assert.False(await service.RevokeSessionAsync(alice.Id, aliceFamily));
    }

    [Fact]
    public async Task ASession_ShowsWhenItBeganAndWasLastUsed()
    {
        var user = await CreateUserAsync();
        var signIn = await SignInAsync(user);
        var first = await db.RefreshTokens.AsNoTracking().SingleAsync();
        await Task.Delay(20);
        await service.RefreshAsync(signIn.RefreshToken, null, null);

        var session = Assert.Single(await service.ListSessionsAsync(user.Id));

        Assert.Equal(first.FamilyId, session.Id);
        Assert.Equal("bfstats-sidecar", session.Client);
        Assert.True(session.LastUsedAt > session.CreatedAt);
        Assert.True(session.ExpiresAt > session.LastUsedAt);
    }

    [Fact]
    public async Task CookieAndAppTokens_DoNotCross()
    {
        var user = await CreateUserAsync();
        var app = await SignInAsync(user);
        var (cookieRaw, _) = await refreshTokens.CreateAsync(user, null, null);

        // The cookie refresh refuses an app's token, with no side effects on it.
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => refreshTokens.ValidateAsync(app.RefreshToken));
        // The app refresh refuses a cookie token, with no side effects on it.
        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(cookieRaw, null, null)).Outcome);

        Assert.All(await db.RefreshTokens.AsNoTracking().ToListAsync(), r => Assert.Null(r.RevokedAt));
        Assert.Equal(AppSignInOutcome.Ok, (await service.RefreshAsync(app.RefreshToken, null, null)).Outcome);
    }

    [Fact]
    public async Task TheCookieRefresh_BehavesAsBefore()
    {
        var user = await CreateUserAsync();
        var (raw, _) = await refreshTokens.CreateAsync(user, "203.0.113.1", "Firefox");

        var (token, validatedUser) = await refreshTokens.ValidateAsync(raw);
        var (newRaw, newEntity) = await refreshTokens.RotateAsync(token, null, null);

        Assert.Equal(user.Id, validatedUser.Id);
        Assert.Null(newEntity.Client);
        Assert.Null(newEntity.Device);
        Assert.Null(newEntity.FamilyId);
        // Replaying the rotated cookie token still revokes its chain.
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => refreshTokens.ValidateAsync(raw));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => refreshTokens.ValidateAsync(newRaw));
        Assert.Empty(await service.ListSessionsAsync(user.Id));
    }

    [Fact]
    public async Task ADiscordAccount_IsNamedByItsAddress()
    {
        var user = await CreateUserAsync("pilot@example.com");
        Assert.Equal("pilot@example.com", (await SignInAsync(user)).User.Username);
    }

    [Fact]
    public async Task ErasingTheAccount_RemovesAppSignInsAndCodes_AndTheExportListsThem()
    {
        var user = await CreateUserAsync();
        var app = await SignInAsync(user);
        await CodeAsync(user.Id);
        var accounts = new AccountService(db, NullLogger<AccountService>.Instance);

        var export = await accounts.ExportAsync(user.Id);
        var session = Assert.Single(export!.Sessions);
        Assert.Equal("bfstats-sidecar", session.Client);
        Assert.Equal("DESKTOP-42", session.Device);
        Assert.DoesNotContain(app.RefreshToken, System.Text.Json.JsonSerializer.Serialize(export));

        db.ChangeTracker.Clear();
        var summary = await accounts.DeleteAsync(user.Id);

        Assert.Equal(1, summary!.SessionsRevoked);
        Assert.Empty(await db.AppAuthorizationCodes.ToListAsync());
        Assert.Empty(await db.RefreshTokens.ToListAsync());
        Assert.Equal(AppSignInOutcome.Unauthorized, (await service.RefreshAsync(app.RefreshToken, null, null)).Outcome);
    }
}
