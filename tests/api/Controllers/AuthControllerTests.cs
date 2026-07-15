using System.Security.Claims;
using api.Auth;
using api.Auth.Models;
using api.PlayerTracking;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace api.tests.Controllers;

public class AuthControllerTests
{
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly AuthController _controller;
    private readonly User _user;

    public AuthControllerTests()
    {
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        _dbContext = new PlayerTrackerDbContext(options);

        _user = new User
        {
            Id = 1,
            Email = "recruit@example.com",
            CreatedAt = DateTime.UtcNow,
            LastLoggedIn = DateTime.UtcNow,
            IsActive = true
        };
        _dbContext.Users.Add(_user);
        _dbContext.SaveChanges();

        var discordAuthService = Substitute.For<IDiscordAuthService>();
        var logger = Substitute.For<ILogger<AuthController>>();
        var tokenService = Substitute.For<ITokenService>();
        var refreshTokenService = Substitute.For<IRefreshTokenService>();
        var configuration = Substitute.For<IConfiguration>();

        _controller = new AuthController(
            _dbContext,
            discordAuthService,
            logger,
            tokenService,
            refreshTokenService,
            configuration)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, _user.Id.ToString())
                    ], "TestAuth"))
                }
            }
        };
    }

    private void SeedPlayer(string name) =>
        _dbContext.Players.Add(new Player { Name = name, FirstSeen = DateTime.UtcNow, LastSeen = DateTime.UtcNow });

    [Fact]
    public async Task AddPlayerNamesBulk_AddsAllValidNames()
    {
        SeedPlayer("Latin66");
        SeedPlayer("Omen");
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Latin66", "Omen"]
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);
        Assert.Equal(2, response.Added.Count);
        Assert.Empty(response.Warnings);
        Assert.Equal(2, await _dbContext.UserPlayerNames.CountAsync(upn => upn.UserId == _user.Id));
    }

    [Fact]
    public async Task AddPlayerNamesBulk_AddsUnknownPlayerNames_WithWarning()
    {
        SeedPlayer("Latin66");
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Latin66", "SomeoneWhoNeverPlayed"]
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);

        // Both names are linked, regardless of whether a Player row matches.
        Assert.Equal(2, response.Added.Count);
        Assert.Contains(response.Added, a => a.PlayerName == "Latin66");
        Assert.Contains(response.Added, a => a.PlayerName == "SomeoneWhoNeverPlayed");
        Assert.Equal(2, await _dbContext.UserPlayerNames.CountAsync(upn => upn.UserId == _user.Id));

        // The one with no matching Player row is flagged, not rejected.
        Assert.Single(response.Warnings);
        Assert.Equal("SomeoneWhoNeverPlayed", response.Warnings[0].PlayerName);
    }

    [Fact]
    public async Task AddPlayerNamesBulk_TreatsExistingAliasAsSoftSuccess()
    {
        SeedPlayer("Latin66");
        await _dbContext.SaveChangesAsync();

        _dbContext.UserPlayerNames.Add(new UserPlayerName
        {
            UserId = _user.Id,
            PlayerName = "Latin66",
            CreatedAt = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Latin66"]
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);
        Assert.Single(response.Added);
        Assert.Empty(response.Warnings);
        // No duplicate row was created for the already-linked alias.
        Assert.Equal(1, await _dbContext.UserPlayerNames.CountAsync(upn => upn.UserId == _user.Id));
    }

    [Fact]
    public async Task AddPlayerNamesBulk_DeduplicatesRequestedNames()
    {
        SeedPlayer("Latin66");
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Latin66", "Latin66", "  Latin66  "]
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);
        Assert.Single(response.Added);
        Assert.Equal(1, await _dbContext.UserPlayerNames.CountAsync(upn => upn.UserId == _user.Id));
    }

    [Fact]
    public async Task AddPlayerNamesBulk_ReturnsBadRequest_WhenBatchExceedsLimit()
    {
        var names = Enumerable.Range(0, 1001).Select(i => $"Player{i}").ToList();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = names
        });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await _dbContext.UserPlayerNames.CountAsync());
    }

    [Fact]
    public async Task AddPlayerNamesBulk_ReturnsBadRequest_WhenListIsEmpty()
    {
        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = []
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task AddPlayerNamesBulk_TrimsLeadingAndTrailingWhitespace()
    {
        SeedPlayer("TargeT");
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["                 TargeT"]
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);
        Assert.Single(response.Added);
        Assert.Equal("TargeT", response.Added[0].PlayerName);
    }

    [Fact]
    public async Task AddPlayerNamesBulk_ReplaceExisting_RemovesPriorAliasesFirst()
    {
        SeedPlayer("Latin66");
        SeedPlayer("Omen");
        await _dbContext.SaveChangesAsync();

        _dbContext.UserPlayerNames.Add(new UserPlayerName
        {
            UserId = _user.Id,
            PlayerName = "Latin66",
            CreatedAt = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Omen"],
            ReplaceExisting = true
        });

        var okResult = Assert.IsType<OkObjectResult>(result);
        var response = Assert.IsType<BulkAddPlayerNamesResponse>(okResult.Value);
        Assert.Single(response.Added);
        Assert.Equal("Omen", response.Added[0].PlayerName);

        var remaining = await _dbContext.UserPlayerNames
            .Where(upn => upn.UserId == _user.Id)
            .ToListAsync();
        Assert.Single(remaining);
        Assert.Equal("Omen", remaining[0].PlayerName);
    }

    [Fact]
    public async Task AddPlayerNamesBulk_WithoutReplaceExisting_KeepsPriorAliases()
    {
        SeedPlayer("Latin66");
        SeedPlayer("Omen");
        await _dbContext.SaveChangesAsync();

        _dbContext.UserPlayerNames.Add(new UserPlayerName
        {
            UserId = _user.Id,
            PlayerName = "Latin66",
            CreatedAt = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();

        var result = await _controller.AddPlayerNamesBulk(new BulkAddPlayerNamesRequest
        {
            PlayerNames = ["Omen"]
        });

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(2, await _dbContext.UserPlayerNames.CountAsync(upn => upn.UserId == _user.Id));
    }
}
