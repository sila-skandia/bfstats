using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using api.PlayerTracking;

namespace api.Auth;

public interface IRefreshTokenService
{
    Task<(string rawToken, RefreshToken entity)> CreateAsync(User user, string? ip, string? userAgent, CancellationToken ct = default);
    /// <summary>An app's first token (features/app-sign-in): a new family, marked with the client and device.</summary>
    Task<(string rawToken, RefreshToken entity)> CreateForAppAsync(User user, string client, string device, string? ip, string? userAgent, CancellationToken ct = default);
    /// <summary>A cookie sign-in's token. An app's token is refused here as if unknown.</summary>
    Task<(RefreshToken token, User user)> ValidateAsync(string rawToken, CancellationToken ct = default);
    /// <summary>An app's token. A cookie sign-in's token is refused here as if unknown.</summary>
    Task<(RefreshToken token, User user)> ValidateAppAsync(string rawToken, CancellationToken ct = default);
    /// <summary>An app's token by its raw value, revoked or not, with no reuse check: for revoking it.</summary>
    Task<RefreshToken?> FindAppTokenAsync(string rawToken, CancellationToken ct = default);
    Task<(string newRawToken, RefreshToken newEntity)> RotateAsync(RefreshToken current, string? ip, string? userAgent, CancellationToken ct = default);
    Task RevokeFamilyAsync(RefreshToken token, CancellationToken ct = default);
    void SetCookie(HttpResponse response, string rawToken, DateTime expiresAt);
    void ClearCookie(HttpResponse response);
}

public class RefreshTokenService(PlayerTrackerDbContext db, IConfiguration config) : IRefreshTokenService
{
    private readonly string _cookieName = config["RefreshToken:CookieName"] ?? "rt";
    private readonly string? _cookieDomain = config["RefreshToken:CookieDomain"];
    private readonly string _cookiePath = config["RefreshToken:CookiePath"] ?? "/stats";
    private readonly int _days = int.TryParse(config["RefreshToken:Days"], out var d) ? d : 60;
    private readonly string _hmacSecret = config["RefreshToken:Secret"] ?? throw new InvalidOperationException("RefreshToken:Secret missing");
    private readonly bool _isDevelopment = (Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development") == "Development";

    public Task<(string rawToken, RefreshToken entity)> CreateAsync(User user, string? ip, string? userAgent, CancellationToken ct = default) =>
        CreateCoreAsync(user.Id, ip, userAgent, client: null, device: null, familyId: null, ct);

    public Task<(string rawToken, RefreshToken entity)> CreateForAppAsync(User user, string client, string device, string? ip, string? userAgent, CancellationToken ct = default) =>
        CreateCoreAsync(user.Id, ip, userAgent, client, device, Guid.NewGuid(), ct);

    private async Task<(string rawToken, RefreshToken entity)> CreateCoreAsync(
        int userId, string? ip, string? userAgent, string? client, string? device, Guid? familyId, CancellationToken ct)
    {
        var raw = Guid.NewGuid().ToString("N") + Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var hash = ComputeHash(raw);
        var now = DateTime.UtcNow;
        var entity = new RefreshToken
        {
            UserId = userId,
            TokenHash = hash,
            CreatedAt = now,
            ExpiresAt = now.AddDays(_days),
            IpAddress = ip,
            UserAgent = userAgent,
            Client = client,
            Device = device,
            FamilyId = familyId
        };
        db.RefreshTokens.Add(entity);
        await SaveWriteAsync(ct);
        return (raw, entity);
    }

    public Task<(RefreshToken token, User user)> ValidateAsync(string rawToken, CancellationToken ct = default) =>
        ValidateCoreAsync(rawToken, app: false, ct);

    public Task<(RefreshToken token, User user)> ValidateAppAsync(string rawToken, CancellationToken ct = default) =>
        ValidateCoreAsync(rawToken, app: true, ct);

    public async Task<RefreshToken?> FindAppTokenAsync(string rawToken, CancellationToken ct = default)
    {
        var hash = ComputeHash(rawToken);
        return await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Client != null, ct);
    }

    /// <summary>
    /// The kind is checked before anything else, and a token of the other kind is "invalid"
    /// with no side effects: presenting an app's token at the cookie refresh (or a cookie's at
    /// the app refresh) neither rotates it nor revokes its family. Reuse detection stays per
    /// kind, at the endpoint the token belongs to.
    /// </summary>
    private async Task<(RefreshToken token, User user)> ValidateCoreAsync(string rawToken, bool app, CancellationToken ct)
    {
        var hash = ComputeHash(rawToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token == null)
            throw new UnauthorizedAccessException("invalid");
        if ((token.Client != null) != app)
            throw new UnauthorizedAccessException("invalid");
        if (token.RevokedAt != null)
        {
            // reuse detection -> revoke family
            await RevokeFamilyAsync(token, ct);
            throw new UnauthorizedAccessException("reused");
        }
        if (token.ExpiresAt <= DateTime.UtcNow)
            throw new UnauthorizedAccessException("expired");

        var user = await db.Users.FirstAsync(u => u.Id == token.UserId, ct);
        return (token, user);
    }

    public async Task<(string newRawToken, RefreshToken newEntity)> RotateAsync(RefreshToken current, string? ip, string? userAgent, CancellationToken ct = default)
    {
        if (current.RevokedAt != null) throw new UnauthorizedAccessException("revoked");

        // An app's token keeps its client, device and family through every rotation.
        var (newRaw, newEntity) = await CreateCoreAsync(current.UserId, ip, userAgent, current.Client, current.Device, current.FamilyId, ct);

        // link family
        current.RevokedAt = DateTime.UtcNow;
        current.ReplacedByTokenHash = newEntity.TokenHash;
        await SaveWriteAsync(ct);

        return (newRaw, newEntity);
    }

    public async Task RevokeFamilyAsync(RefreshToken token, CancellationToken ct = default)
    {
        // Walk forward revocations
        var toRevoke = new List<RefreshToken> { token };
        while (true)
        {
            var next = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == token.ReplacedByTokenHash!, ct);
            if (next == null) break;
            toRevoke.Add(next);
            token = next;
        }

        foreach (var t in toRevoke)
        {
            if (t.RevokedAt == null) t.RevokedAt = DateTime.UtcNow;
        }
        await SaveWriteAsync(ct);
    }

    // The hourly incremental holds the one SQLite writer for ~1-2 min.
    // CommandTimeout(60) would sit on this one-row INSERT until the Slow
    // page fires; 5s matches busy_timeout and the request returns 503 instead.
    internal const int WriteCommandTimeoutSeconds = 5;

    private async Task SaveWriteAsync(CancellationToken ct)
    {
        var previous = db.Database.GetCommandTimeout();
        db.Database.SetCommandTimeout(WriteCommandTimeoutSeconds);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        finally
        {
            db.Database.SetCommandTimeout(previous);
        }
    }

    public void SetCookie(HttpResponse response, string rawToken, DateTime expiresAt)
    {
        var opts = new CookieOptions
        {
            HttpOnly = true,
            Secure = !_isDevelopment,
            SameSite = SameSiteMode.Lax,
            Expires = expiresAt,
            MaxAge = expiresAt - DateTime.UtcNow,
            Path = _cookiePath
        };
        if (!string.IsNullOrEmpty(_cookieDomain)) opts.Domain = _cookieDomain;
        response.Cookies.Append(_cookieName, rawToken, opts);
    }

    public void ClearCookie(HttpResponse response)
    {
        response.Cookies.Delete(_cookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = !_isDevelopment,
            SameSite = SameSiteMode.Lax,
            Path = _cookiePath,
            Domain = _cookieDomain
        });
    }

    private string ComputeHash(string raw)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_hmacSecret));
        var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes);
    }
}
