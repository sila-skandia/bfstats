using System.Security.Claims;
using api.AppSignIn;
using api.AppSignIn.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;

namespace api.tests.AppSignIn;

public sealed class AppSignInControllerTests
{
    private const int UserId = 7;
    private readonly IAppSignInService service = Substitute.For<IAppSignInService>();

    private AppSignInController Controller(int? userId = UserId) => new(service)
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

    private static readonly AuthorizeAppRequest Body = new("bfstats-sidecar", "pc", "http://127.0.0.1:5000/callback", "s", "c", "S256");

    [Fact]
    public async Task Authorize_AnswersTheCode()
    {
        var answer = new AuthorizeAppResponse("code", "http://127.0.0.1:5000/callback");
        service.AuthorizeAsync(UserId, Body, Arg.Any<CancellationToken>()).Returns(AppSignInResult.Ok(answer));

        var result = await Controller().Authorize(Body, CancellationToken.None);

        Assert.Same(answer, Assert.IsType<OkObjectResult>(result).Value);
    }

    [Theory]
    [InlineData(AppSignInOutcome.InvalidRequest, 400)]
    [InlineData(AppSignInOutcome.InvalidGrant, 400)]
    [InlineData(AppSignInOutcome.Unauthorized, 401)]
    [InlineData(AppSignInOutcome.Busy, 503)]
    public async Task Token_MapsRefusals(AppSignInOutcome outcome, int status)
    {
        var request = new AppTokenRequest("c", "v", "r");
        service.ExchangeAsync(request, Arg.Any<string?>(), Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(AppSignInResult.Fail<AppTokenResponse>(outcome, "invalid_grant", "why"));

        var result = await Controller(userId: null).Token(request, CancellationToken.None);

        Assert.Equal(status, Assert.IsAssignableFrom<ObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task Refresh_MapsBusyTo503()
    {
        service.RefreshAsync("tok", Arg.Any<string?>(), Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(AppSignInResult.Fail<AppTokenResponse>(
                AppSignInOutcome.Busy, "temporarily_unavailable", "The stats database is busy updating; try again in a minute"));

        var result = await Controller(userId: null).Refresh(new AppRefreshRequest("tok"), CancellationToken.None);

        var body = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(503, body.StatusCode);
    }

    [Fact]
    public async Task Revoke_IsAlwaysNoContent()
    {
        Assert.IsType<NoContentResult>(await Controller(userId: null).Revoke(new AppRefreshRequest("x"), CancellationToken.None));
        await service.Received(1).RevokeAsync("x", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteSession_IsNotFound_WhenItIsNotTheirs()
    {
        var id = Guid.NewGuid();
        service.RevokeSessionAsync(UserId, id, Arg.Any<CancellationToken>()).Returns(false);

        Assert.IsType<NotFoundObjectResult>(await Controller().DeleteSession(id, CancellationToken.None));
    }

    [Fact]
    public async Task WithoutAUserId_TheSignedInRoutesAreUnauthorized()
    {
        Assert.IsType<UnauthorizedObjectResult>(await Controller(userId: null).Authorize(Body, CancellationToken.None));
        Assert.IsType<UnauthorizedObjectResult>((await Controller(userId: null).Sessions(CancellationToken.None)).Result);
        await service.DidNotReceiveWithAnyArgs().AuthorizeAsync(default, default!);
    }
}
