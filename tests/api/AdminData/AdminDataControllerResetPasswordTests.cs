using System.Security.Claims;
using api.AdminData;
using api.AdminData.Models;
using api.Auth;
using api.PlayerTracking;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;

namespace api.tests.AdminData;

public class AdminDataControllerResetPasswordTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly PasswordHashService _hasher = new();

    public AdminDataControllerResetPasswordTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();
        _dbContext = new PlayerTrackerDbContext(
            new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(_connection).Options);
        _dbContext.Database.EnsureCreated();
    }

    private AdminDataController BuildController(string? adminEmail = "admin@bfstats.io")
    {
        var claims = new List<Claim>();
        if (adminEmail != null) claims.Add(new Claim(ClaimTypes.Email, adminEmail));
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build();
        return new AdminDataController(
            Substitute.For<IAdminDataService>(),
            Substitute.For<IServerMergeService>(),
            _dbContext,
            _hasher,
            new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            NullLogger<AdminDataController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"))
                }
            }
        };
    }

    private async Task<User> CreateUserAsync(string provider, string? username = null)
    {
        var user = new User
        {
            Email = $"user-{Guid.NewGuid():N}@example.com",
            Username = username,
            AuthProvider = provider,
            CreatedAt = DateTime.UtcNow,
            LastLoggedIn = DateTime.UtcNow,
            IsActive = true
        };
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task ResetPassword_GeneratesAWorkingTemporaryPassword_AndRevokesSessions()
    {
        var user = await CreateUserAsync("password", "PattonsGhost");
        user.PasswordHash = _hasher.Hash("old-password");
        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = "live-session",
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        });
        await _dbContext.SaveChangesAsync();

        var controller = BuildController();
        var result = await controller.ResetUserPassword(user.Id);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<ResetPasswordResponse>(ok.Value);
        Assert.Equal("PattonsGhost", response.Username);
        Assert.Matches("^[A-Za-z0-9]{16}$", response.TemporaryPassword);

        // The stored hash verifies against the temp password and nothing else.
        _dbContext.ChangeTracker.Clear();
        var stored = await _dbContext.Users.AsNoTracking().FirstAsync(u => u.Id == user.Id);
        Assert.True(_hasher.Verify(response.TemporaryPassword, stored.PasswordHash!));
        Assert.False(_hasher.Verify("old-password", stored.PasswordHash!));

        // Every live session died with the credential.
        var revoked = await _dbContext.RefreshTokens.AsNoTracking().FirstAsync(rt => rt.TokenHash == "live-session");
        Assert.NotNull(revoked.RevokedAt);

        // The action is on the audit trail.
        var audit = await _dbContext.AdminAuditLogs.AsNoTracking()
            .FirstAsync(l => l.TargetId == user.Id.ToString());
        Assert.Equal("reset_password", audit.Action);
        Assert.Equal("admin@bfstats.io", audit.AdminEmail);
    }

    [Fact]
    public async Task ResetPassword_RejectsDiscordAndErasedAccounts()
    {
        var discordUser = await CreateUserAsync("discord");
        var deletedUser = await CreateUserAsync("deleted");

        var controller = BuildController();
        Assert.IsType<BadRequestObjectResult>((await controller.ResetUserPassword(discordUser.Id)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.ResetUserPassword(deletedUser.Id)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.ResetUserPassword(999999)).Result);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }
}