using System.Security.Claims;
using api.Authorization;

namespace api.tests.Auth;

/// <summary>
/// The always-admin email is configuration (Auth:AdminEmail). Unset, it must make nobody an admin,
/// above all not a user with no email (string.Equals(null, null) is true).
/// </summary>
[Collection(nameof(AppRolesTests))]
public class AppRolesTests : IDisposable
{
    private readonly string? _before = AppRoles.AdminEmail;

    public void Dispose() => AppRoles.Configure(_before);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Unset_admin_email_matches_nobody(string? configured)
    {
        AppRoles.Configure(configured);

        Assert.Null(AppRoles.AdminEmail);
        Assert.False(AppRoles.IsAdminEmail(null));
        Assert.False(AppRoles.IsAdminEmail(""));
        Assert.False(AppRoles.IsAdminEmail("someone@example.com"));
        Assert.False(AppRoles.HasAdminEmail(new ClaimsPrincipal(new ClaimsIdentity())));
    }

    [Fact]
    public void Configured_admin_email_matches_case_insensitively_and_trimmed()
    {
        AppRoles.Configure("  Admin@Example.com ");

        Assert.True(AppRoles.IsAdminEmail("admin@example.com"));
        Assert.False(AppRoles.IsAdminEmail("other@example.com"));
        Assert.False(AppRoles.IsAdminEmail(null));
        var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, "ADMIN@example.com")], "test"));
        Assert.True(AppRoles.HasAdminEmail(user));
        var other = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, "other@example.com")], "test"));
        Assert.False(AppRoles.HasAdminEmail(other));
    }
}
