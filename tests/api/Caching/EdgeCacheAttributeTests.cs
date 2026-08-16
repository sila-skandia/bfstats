using api.Caching;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;

namespace api.tests.Caching;

public class EdgeCacheAttributeTests
{
    private static ResultExecutingContext ContextFor(IActionResult result)
    {
        var httpContext = new DefaultHttpContext();
        var actionContext = new ActionContext(httpContext, new RouteData(), new ControllerActionDescriptor());
        return new ResultExecutingContext(actionContext, [], result, controller: null!);
    }

    [Fact]
    public void SetsSharedCacheHeader_WithoutLettingTheBrowserHoldACopy()
    {
        var context = ContextFor(new OkObjectResult(new { ok = true }));

        new EdgeCacheAttribute(30).OnResultExecuting(context);

        Assert.Equal(
            "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
            context.HttpContext.Response.Headers.CacheControl);
    }

    [Fact]
    public void StaleWhileRevalidate_IsOverridable()
    {
        var context = ContextFor(new OkObjectResult(new { ok = true }));

        new EdgeCacheAttribute(300) { StaleWhileRevalidate = 15 }.OnResultExecuting(context);

        Assert.Equal(
            "public, max-age=0, s-maxage=300, stale-while-revalidate=15",
            context.HttpContext.Response.Headers.CacheControl);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(404)]
    [InlineData(500)]
    public void DoesNotCacheFailures(int statusCode)
    {
        // The status code is still on the result at this point, not yet copied onto
        // the response — reading only Response.StatusCode would see the default 200
        // and happily hand the edge a cacheable 404.
        var context = ContextFor(new ObjectResult("nope") { StatusCode = statusCode });

        new EdgeCacheAttribute(30).OnResultExecuting(context);

        Assert.False(context.HttpContext.Response.Headers.ContainsKey("Cache-Control"));
    }

    [Fact]
    public void FallsBackToResponseStatus_WhenTheResultCarriesNone()
    {
        var context = ContextFor(new EmptyResult());
        context.HttpContext.Response.StatusCode = 503;

        new EdgeCacheAttribute(30).OnResultExecuting(context);

        Assert.False(context.HttpContext.Response.Headers.ContainsKey("Cache-Control"));
    }

    // These endpoints carry live state and are re-fetched by their pages. If one
    // regresses to [ResponseCache], the browser can reuse an old response without
    // issuing a request when the user revisits the page.
    //
    // The player-page endpoints below were previously uncached entirely — they served
    // cf-cache-status: BYPASS for want of any Cache-Control header. They are listed here
    // so that dropping the attribute again is a test failure rather than a silent
    // regression back to a full origin round trip per view.
    [Theory]
    [InlineData(typeof(api.Players.PlayersController), "GetPlayerStats", 30)]
    [InlineData(typeof(api.Servers.ServersController), "GetServerStats", 30)]
    [InlineData(typeof(api.Controllers.LiveServersController), "GetServers", 30)]
    [InlineData(typeof(api.Controllers.LiveServersController), "GetServer", 10)]
    [InlineData(typeof(api.Controllers.GamificationController), "GetPlayerAchievementGroups", 60)]
    [InlineData(typeof(api.Controllers.GamificationController), "GetPlayerHeroAchievements", 60)]
    [InlineData(typeof(api.PlayerRelationships.CommunitiesController), "GetPlayerCommunities", 300)]
    public void LiveEndpoints_AreEdgeCachedAndNotBrowserCached(
        Type controller,
        string action,
        int expectedSMaxAge)
    {
        var method = controller.GetMethod(action)!;

        // IFilterMetadata is how MVC's DefaultFilterProvider discovers attribute
        // filters, so finding it here is what makes the filter actually run.
        var edgeCache = Assert.Single(method.GetCustomAttributes(typeof(EdgeCacheAttribute), inherit: true));
        Assert.IsAssignableFrom<IFilterMetadata>(edgeCache);
        Assert.Equal(expectedSMaxAge, GetSMaxAge((EdgeCacheAttribute)edgeCache));

        Assert.Empty(method.GetCustomAttributes(typeof(ResponseCacheAttribute), inherit: true));
    }

    private static int GetSMaxAge(EdgeCacheAttribute attribute)
    {
        var context = ContextFor(new OkResult());
        attribute.OnResultExecuting(context);
        var header = context.HttpContext.Response.Headers.CacheControl.ToString();
        return int.Parse(
            header.Split("s-maxage=")[1].Split(',')[0],
            System.Globalization.CultureInfo.InvariantCulture);
    }
}
