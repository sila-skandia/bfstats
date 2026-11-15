using System.Security.Claims;

namespace api.Authorization;

/// <summary>
/// Role and admin constants. Roles are included in the JWT; Admin is granted to the configured admin email
/// (<c>Auth:AdminEmail</c>, a secret in production, never in the repo).
/// </summary>
public static class AppRoles
{
    public const string User = "User";
    public const string Support = "Support";
    public const string Admin = "Admin";
    /// <summary>
    /// Testers of an app before it is public: the early access page and its downloads
    /// (features/early-access-sidecar). Admin has the same access; Support does not.
    /// </summary>
    public const string EarlyAdopter = "EarlyAdopter";

    /// <summary>The policy for early access: an Early Adopter or an admin.</summary>
    public const string EarlyAccessPolicy = "EarlyAccess";

    /// <summary>The roles an admin can give a user on the Access tab. Admin is the configured email, never given.</summary>
    public static readonly IReadOnlyList<string> Assignable = [User, EarlyAdopter, Support];

    /// <summary>True for an Early Adopter or an admin (the role, or the configured email).</summary>
    public static bool HasEarlyAccess(ClaimsPrincipal user) =>
        user.IsInRole(Admin) || user.IsInRole(EarlyAdopter) || HasAdminEmail(user);

    /// <summary>The one email always treated as Admin (can delete rounds, manage user roles); null when unset.</summary>
    public static string? AdminEmail { get; private set; }

    /// <summary>Set once at startup from configuration. Blank leaves no admin email at all.</summary>
    public static void Configure(string? adminEmail) =>
        AdminEmail = string.IsNullOrWhiteSpace(adminEmail) ? null : adminEmail.Trim();

    /// <summary>True only for the configured admin email; never for a missing email or an unset admin.</summary>
    public static bool IsAdminEmail(string? email) =>
        AdminEmail is not null && email is not null && string.Equals(email, AdminEmail, StringComparison.OrdinalIgnoreCase);

    /// <summary>True when the principal's email claim is the configured admin email.</summary>
    public static bool HasAdminEmail(ClaimsPrincipal user) =>
        AdminEmail is not null && user.FindAll(ClaimTypes.Email).Any(c => IsAdminEmail(c.Value));
}
