using System.Security.Claims;
using api.GameProfiles;
using api.GameProfiles.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NodaTime;
using NSubstitute;

namespace api.tests.GameProfiles;

public sealed class GameProfilesControllerTests
{
    private const int UserId = 7;
    private readonly IGameProfileService service = Substitute.For<IGameProfileService>();

    private GameProfilesController Controller(int? userId = UserId) => new(service)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    userId is { } id ? [new Claim(ClaimTypes.NameIdentifier, id.ToString())] : [], "test")),
            },
        },
    };

    private static readonly UpsertGameProfileRequest Body = new(null, new Dictionary<string, string?> { ["Controls/Air.con"] = "x" });

    [Fact]
    public async Task Upsert_AnswersTheProfile()
    {
        var profile = new GameProfileResponse("skandia", "skandia", true, Instant.FromUtc(2026, 10, 25, 0, 0), new Dictionary<string, string>());
        service.UpsertAsync(UserId, "skandia", Body, Arg.Any<CancellationToken>()).Returns(GameProfileResult.Ok(profile));

        var result = await Controller().Upsert("skandia", Body, CancellationToken.None);

        Assert.Same(profile, Assert.IsType<OkObjectResult>(result).Value);
    }

    [Theory]
    [InlineData(GameProfileOutcome.Invalid, 400)]
    [InlineData(GameProfileOutcome.NotFound, 404)]
    [InlineData(GameProfileOutcome.LimitReached, 409)]
    [InlineData(GameProfileOutcome.Conflict, 409)]
    [InlineData(GameProfileOutcome.Busy, 503)]
    public async Task Upsert_MapsRefusalsToStatusCodes(GameProfileOutcome outcome, int status)
    {
        service.UpsertAsync(UserId, "x", Body, Arg.Any<CancellationToken>()).Returns(GameProfileResult.Fail(outcome, "why"));

        var result = await Controller().Upsert("x", Body, CancellationToken.None);

        Assert.Equal(status, Assert.IsAssignableFrom<ObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task ActivateAndDelete_AnswerNoContent_OrNotFound()
    {
        service.ActivateAsync(UserId, "a", Arg.Any<CancellationToken>()).Returns(GameProfileResult.Ok());
        service.DeleteAsync(UserId, "a", Arg.Any<CancellationToken>()).Returns(GameProfileResult.Ok());
        service.DeleteAsync(UserId, "b", Arg.Any<CancellationToken>())
            .Returns(GameProfileResult.Fail(GameProfileOutcome.NotFound, "Profile not found"));

        Assert.IsType<NoContentResult>(await Controller().Activate("a", CancellationToken.None));
        Assert.IsType<NoContentResult>(await Controller().Delete("a", CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await Controller().Delete("b", CancellationToken.None));
    }

    [Fact]
    public async Task SetSidecarName_Busy_Is503()
    {
        service.SetSidecarNameAsync(UserId, "skandia", "Sidecar", Arg.Any<CancellationToken>())
            .Returns(GameProfileResult.Fail(GameProfileOutcome.Busy, "The database is busy; try again"));

        var result = await Controller().SetSidecarName(
            "skandia", new SetSidecarNameRequest { SidecarName = "Sidecar" }, CancellationToken.None);

        var body = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(503, body.StatusCode);
    }

    [Fact]
    public async Task WithoutAUserId_ItIsUnauthorized()
    {
        var result = await Controller(userId: null).List(CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
        await service.DidNotReceiveWithAnyArgs().ListAsync(default);
    }
}
