using api.Auth;
using api.Auth.Models;
using api.Caching;
using api.DiscordNotifications;
using api.DiscordNotifications.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using NSubstitute;

namespace api.tests.Auth;

/// <summary>Password reset by email (features/password-reset), against SQLite.</summary>
public sealed class PasswordResetServiceTests : IDisposable
{
    private sealed class FixedClock : IClock
    {
        public Instant Now { get; set; } = SystemClock.Instance.GetCurrentInstant();
        public Instant GetCurrentInstant() => Now;
    }

    private sealed class MemoryCache : ICacheService
    {
        private readonly Dictionary<string, object> items = [];
        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default) where T : class =>
            Task.FromResult(items.TryGetValue(key, out var value) ? value as T : null);
        public Task SetAsync<T>(string key, T value, TimeSpan expiration, CancellationToken cancellationToken = default)
        {
            items[key] = value!;
            return Task.CompletedTask;
        }
        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            items.Remove(key);
            return Task.CompletedTask;
        }
        public void Clear() => items.Clear();
    }

    private const string Address = "Player@Example.com";

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext db;
    private readonly FixedClock clock = new();
    private readonly MemoryCache cache = new();
    private readonly EmailHashService emailHash;
    private readonly PasswordHashService passwordHash = new();
    private readonly IEmailSender email = Substitute.For<IEmailSender>();
    private readonly IDiscordWebhookService discord = Substitute.For<IDiscordWebhookService>();
    private readonly PasswordResetService service;

    public PasswordResetServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:EmailHashKey"] = "test-email-hash-key",
                ["PasswordReset:SiteBaseUrl"] = "https://bfstats.test/",
            })
            .Build();
        emailHash = new EmailHashService(config);
        service = new PasswordResetService(db, emailHash, passwordHash, email, discord, cache, clock, config,
            NullLogger<PasswordResetService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        connection.Dispose();
    }

    private async Task<User> CreatePasswordUserAsync(string username = "Recruit", string? address = Address)
    {
        var user = new User
        {
            Username = username,
            AuthProvider = "password",
            Email = address is null ? $"no-email-{Guid.NewGuid()}@users.bfstats.io" : emailHash.Hash(address),
            PasswordHash = passwordHash.Hash("old-password"),
            CreatedAt = DateTime.UtcNow,
            LastLoggedIn = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    /// <summary>Requests a link and pulls the token back out of the email that was sent.</summary>
    private async Task<string> RequestTokenAsync(string username = "recruit", string typed = "  player@example.COM ")
    {
        EmailMessage? sent = null;
        email.When(e => e.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>()))
            .Do(call => sent = call.Arg<EmailMessage>());
        await service.RequestAsync(username, typed);
        Assert.NotNull(sent);
        const string marker = "/auth/reset-password?token=";
        var start = sent!.Text.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
        var end = sent.Text.IndexOfAny(['\n', '\r', ' '], start);
        return sent.Text[start..(end < 0 ? sent.Text.Length : end)];
    }

    [Fact]
    public async Task MatchingUsernameAndEmail_SendsOneLinkToTheTypedAddress()
    {
        await CreatePasswordUserAsync();
        EmailMessage? sent = null;
        email.When(e => e.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>()))
            .Do(call => sent = call.Arg<EmailMessage>());

        await service.RequestAsync(" RECRUIT ", "player@example.com");

        Assert.NotNull(sent);
        Assert.Equal("player@example.com", sent!.To);
        Assert.Contains("https://bfstats.test/auth/reset-password?token=", sent.Html);
        Assert.Contains("https://bfstats.test/email/logo.png", sent.Html);
        Assert.Contains("Recruit", sent.Text);
        // The row keeps a hash, never the token the email carries.
        var row = Assert.Single(db.PasswordResetTokens.AsNoTracking());
        Assert.DoesNotContain(row.TokenHash, sent.Text);
        await discord.DidNotReceiveWithAnyArgs().SendPasswordResetHelpAsync(default!);
    }

    [Fact]
    public async Task WrongEmail_SendsNothingAndAsksTheOwner()
    {
        var user = await CreatePasswordUserAsync();

        await service.RequestAsync("recruit", "someone-else@example.com");

        await email.DidNotReceiveWithAnyArgs().SendAsync(default!);
        await discord.Received(1).SendPasswordResetHelpAsync(
            new PasswordResetHelpRequest(user.Id, "Recruit", PasswordResetHelpReason.EmailDidNotMatch));
        Assert.Empty(db.PasswordResetTokens);
    }

    [Fact]
    public async Task AccountWithNoEmail_AsksTheOwnerOncePerHour()
    {
        var user = await CreatePasswordUserAsync(address: null);

        await service.RequestAsync("recruit", "");
        await service.RequestAsync("recruit", "guess@example.com");

        await email.DidNotReceiveWithAnyArgs().SendAsync(default!);
        await discord.Received(1).SendPasswordResetHelpAsync(
            new PasswordResetHelpRequest(user.Id, "Recruit", PasswordResetHelpReason.NoEmailOnAccount));
    }

    [Fact]
    public async Task UnknownUsernameAndDiscordAccounts_DoNothing()
    {
        db.Users.Add(new User { Email = Address, Username = null, AuthProvider = "discord", CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow });
        await db.SaveChangesAsync();

        await service.RequestAsync("nobody", Address);
        await service.RequestAsync("", Address);

        await email.DidNotReceiveWithAnyArgs().SendAsync(default!);
        await discord.DidNotReceiveWithAnyArgs().SendPasswordResetHelpAsync(default!);
    }

    [Fact]
    public async Task RepeatRequests_InsideTheCooldown_SendOneEmail()
    {
        await CreatePasswordUserAsync();

        await service.RequestAsync("recruit", Address);
        await service.RequestAsync("recruit", Address);

        await email.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ALink_SetsThePasswordOnce_AndSignsOutEverySession()
    {
        var user = await CreatePasswordUserAsync();
        db.RefreshTokens.Add(new RefreshToken { UserId = user.Id, TokenHash = "live", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(30) });
        await db.SaveChangesAsync();
        var token = await RequestTokenAsync();

        Assert.Equal(PasswordResetOutcome.Reset, await service.ResetAsync(token, "brand-new-password"));
        Assert.Equal(PasswordResetOutcome.InvalidLink, await service.ResetAsync(token, "another-password"));

        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);
        Assert.True(passwordHash.Verify("brand-new-password", stored.PasswordHash!));
        Assert.False(passwordHash.Verify("old-password", stored.PasswordHash!));
        Assert.All(db.RefreshTokens.AsNoTracking(), rt => Assert.NotNull(rt.RevokedAt));
    }

    [Fact]
    public async Task AnExpiredLink_IsRefused()
    {
        await CreatePasswordUserAsync();
        var token = await RequestTokenAsync();

        clock.Now += PasswordResetService.LinkLifetime + Duration.FromSeconds(1);

        Assert.Equal(PasswordResetOutcome.InvalidLink, await service.ResetAsync(token, "brand-new-password"));
    }

    [Fact]
    public async Task ANewerLink_SupersedesTheOlderOne()
    {
        await CreatePasswordUserAsync();
        var first = await RequestTokenAsync();
        cache.Clear(); // past the email cooldown
        var second = await RequestTokenAsync();

        Assert.NotEqual(first, second);
        Assert.Equal(PasswordResetOutcome.InvalidLink, await service.ResetAsync(first, "brand-new-password"));
        Assert.Equal(PasswordResetOutcome.Reset, await service.ResetAsync(second, "brand-new-password"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    public async Task AShortPassword_IsRefusedWithoutSpendingTheLink(string? password)
    {
        await CreatePasswordUserAsync();
        var token = await RequestTokenAsync();

        Assert.Equal(PasswordResetOutcome.WeakPassword, await service.ResetAsync(token, password));
        Assert.Equal(PasswordResetOutcome.Reset, await service.ResetAsync(token, "long-enough-now"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-real-token")]
    public async Task AnUnknownToken_IsRefused(string? token) =>
        Assert.Equal(PasswordResetOutcome.InvalidLink, await service.ResetAsync(token, "brand-new-password"));

    [Fact]
    public async Task AFailedSend_StillAnswersQuietly()
    {
        await CreatePasswordUserAsync();
        email.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new EmailDeliveryException("refused")));

        await service.RequestAsync("recruit", Address); // does not throw
    }
}
