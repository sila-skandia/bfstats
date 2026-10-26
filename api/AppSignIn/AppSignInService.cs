using System.Diagnostics;
using api.AppSignIn.Models;
using api.Auth;
using api.PlayerTracking;
using api.StatsCollectors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.AppSignIn;

/// <summary>
/// The browser hand-off (features/app-sign-in): the Allow page mints a one-time code bound
/// to the user, client, redirect URI and PKCE challenge; the app trades it for a normal
/// access token and a refresh token of its own family, marked with the client and device.
/// The refresh token is the site's <see cref="IRefreshTokenService"/> machinery (rotation,
/// reuse revoking the family); only the kind check keeps the two sorts apart.
/// </summary>
public class AppSignInService(
    PlayerTrackerDbContext db,
    IRefreshTokenService refreshTokens,
    ITokenService tokens,
    IClock clock,
    ILogger<AppSignInService> logger) : IAppSignInService
{
    public static readonly Duration CodeLifetime = Duration.FromMinutes(2);

    internal const int WriteCommandTimeoutSeconds = RefreshTokenService.WriteCommandTimeoutSeconds;

    private const string InvalidRequest = "invalid_request";
    private const string InvalidGrant = "invalid_grant";

    public async Task<AppSignInResult<AuthorizeAppResponse>> AuthorizeAsync(int userId, AuthorizeAppRequest request, CancellationToken cancellationToken = default)
    {
        if (!AppSignInRules.IsKnownClient(request.Client))
            return Refuse<AuthorizeAppResponse>("Unknown client");
        if (!AppSignInRules.IsValidRedirectUri(request.RedirectUri))
            return Refuse<AuthorizeAppResponse>("redirectUri must be http://127.0.0.1:<port>/callback or http://localhost:<port>/callback");
        if (!AppSignInRules.IsValidState(request.State))
            return Refuse<AuthorizeAppResponse>("state is missing or not URL-safe");
        if (!string.Equals(request.CodeChallengeMethod, AppSignInRules.ChallengeMethod, StringComparison.Ordinal))
            return Refuse<AuthorizeAppResponse>("Only the S256 code challenge method is accepted");
        if (!AppSignInRules.IsValidChallenge(request.CodeChallenge))
            return Refuse<AuthorizeAppResponse>("codeChallenge must be base64url(SHA-256(verifier))");

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null || AccountService.IsTombstoned(user))
            return AppSignInResult.Fail<AuthorizeAppResponse>(AppSignInOutcome.Unauthorized, InvalidRequest, "Not signed in");

        return await WriteAsync("authorize", async () =>
        {
            var now = clock.GetCurrentInstant();

            // Housekeeping: this user's spent and lapsed codes go. Few rows, filtered here because
            // the stored instants are ExtendedIso strings, which do not compare as text.
            var stale = (await db.AppAuthorizationCodes.Where(c => c.UserId == userId).ToListAsync(cancellationToken))
                .Where(c => c.UsedAt != null || c.ExpiresAt <= now)
                .ToList();
            db.AppAuthorizationCodes.RemoveRange(stale);

            var code = AppSignInRules.NewCode();
            db.AppAuthorizationCodes.Add(new AppAuthorizationCode
            {
                CodeHash = AppSignInRules.HashCode(code),
                UserId = userId,
                Client = request.Client!,
                Device = AppSignInRules.NormalizeDevice(request.Device),
                RedirectUri = request.RedirectUri!,
                CodeChallenge = request.CodeChallenge!,
                CreatedAt = now,
                ExpiresAt = now + CodeLifetime,
            });
            await db.SaveChangesAsync(cancellationToken);

            return AppSignInResult.Ok(new AuthorizeAppResponse(code, request.RedirectUri!));
        });
    }

    public async Task<AppSignInResult<AppTokenResponse>> ExchangeAsync(AppTokenRequest request, string? ipAddress, string? userAgent, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(request.Code) || request.Code.Length > 128
            || string.IsNullOrEmpty(request.CodeVerifier) || string.IsNullOrEmpty(request.RedirectUri))
            return Refuse<AppTokenResponse>("code, codeVerifier and redirectUri are required");

        var hash = AppSignInRules.HashCode(request.Code);
        var row = await db.AppAuthorizationCodes.AsNoTracking().FirstOrDefaultAsync(c => c.CodeHash == hash, cancellationToken);
        if (row is null) return Grant("Unknown code");

        return await WriteAsync("exchange", async () =>
        {
            // Claim it before anything else: the first attempt spends the code whatever it
            // brings, so a wrong verifier cannot be retried, and two racing exchanges cannot
            // both pass (the update only matches while UsedAt is null).
            var now = clock.GetCurrentInstant();
            var claimed = await db.AppAuthorizationCodes
                .Where(c => c.Id == row.Id && c.UsedAt == null)
                .ExecuteUpdateAsync(set => set.SetProperty(c => c.UsedAt, (Instant?)now), cancellationToken);
            if (claimed == 0)
            {
                // A code presented twice: whatever the first exchange issued is revoked too (RFC 6749 4.1.2).
                if (row.FamilyId is { } issued) await RevokeFamilyAsync(issued, cancellationToken);
                logger.LogWarning("App sign-in code reused for user {UserId}; its sign-in is revoked", row.UserId);
                return Grant("Code already used");
            }

            if (now >= row.ExpiresAt) return Grant("Code expired");
            if (!string.Equals(request.RedirectUri, row.RedirectUri, StringComparison.Ordinal))
                return Grant("redirectUri does not match the one the code was issued for");
            if (!AppSignInRules.IsValidVerifier(request.CodeVerifier)
                || !AppSignInRules.VerifierMatches(request.CodeVerifier, row.CodeChallenge))
                return Grant("codeVerifier does not match the challenge");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == row.UserId, cancellationToken);
            if (user is null || AccountService.IsTombstoned(user)) return Grant("Account not found");

            var (rawRefresh, entity) = await refreshTokens.CreateForAppAsync(user, row.Client, row.Device, ipAddress, userAgent, cancellationToken);
            await db.AppAuthorizationCodes
                .Where(c => c.Id == row.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(c => c.FamilyId, entity.FamilyId), cancellationToken);

            logger.LogInformation("App {Client} signed in for user {UserId}", row.Client, user.Id);
            return AppSignInResult.Ok(Answer(user, rawRefresh, entity));
        });
    }

    public async Task<AppSignInResult<AppTokenResponse>> RefreshAsync(string? refreshToken, string? ipAddress, string? userAgent, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(refreshToken))
            return AppSignInResult.Fail<AppTokenResponse>(AppSignInOutcome.Unauthorized, InvalidGrant, "Missing refresh token");
        return await WriteAsync("refresh", async () =>
        {
            try
            {
                var (current, user) = await refreshTokens.ValidateAppAsync(refreshToken, cancellationToken);
                if (AccountService.IsTombstoned(user))
                    return AppSignInResult.Fail<AppTokenResponse>(AppSignInOutcome.Unauthorized, InvalidGrant, "Invalid refresh token");
                var (rawRefresh, entity) = await refreshTokens.RotateAsync(current, ipAddress, userAgent, cancellationToken);
                return AppSignInResult.Ok(Answer(user, rawRefresh, entity));
            }
            catch (UnauthorizedAccessException)
            {
                return AppSignInResult.Fail<AppTokenResponse>(AppSignInOutcome.Unauthorized, InvalidGrant, "Invalid refresh token");
            }
        });
    }

    public async Task RevokeAsync(string? refreshToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(refreshToken)) return;
        var token = await refreshTokens.FindAppTokenAsync(refreshToken, cancellationToken);
        if (token is null) return;
        if (token.FamilyId is { } family) await RevokeFamilyAsync(family, cancellationToken);
        else await refreshTokens.RevokeFamilyAsync(token, cancellationToken);
    }

    public async Task<IReadOnlyList<AppSessionResponse>> ListSessionsAsync(int userId, CancellationToken cancellationToken = default)
    {
        var rows = await db.RefreshTokens.AsNoTracking()
            .Where(t => t.UserId == userId && t.Client != null && t.FamilyId != null)
            .Select(t => new { t.FamilyId, t.Client, t.Device, t.CreatedAt, t.ExpiresAt, t.RevokedAt })
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        return rows
            .GroupBy(t => t.FamilyId!.Value)
            .Select(family => (family, live: family.FirstOrDefault(t => t.RevokedAt == null && t.ExpiresAt > now)))
            .Where(x => x.live is not null)
            .Select(x => new AppSessionResponse(
                x.family.Key,
                x.live!.Client!,
                x.live.Device ?? AppSignInRules.UnnamedDevice,
                ToInstant(x.family.Min(t => t.CreatedAt)),
                ToInstant(x.family.Max(t => t.CreatedAt)),
                ToInstant(x.live.ExpiresAt)))
            .OrderByDescending(s => s.LastUsedAt)
            .ToList();
    }

    public async Task<bool> RevokeSessionAsync(int userId, Guid sessionId, CancellationToken cancellationToken = default) =>
        await RevokeAsync(t => t.UserId == userId && t.FamilyId == sessionId && t.Client != null, cancellationToken) > 0;

    private Task<int> RevokeFamilyAsync(Guid familyId, CancellationToken cancellationToken) =>
        RevokeAsync(t => t.FamilyId == familyId, cancellationToken);

    /// <summary>Revokes the live tokens that match, through the change tracker so a token this
    /// scope already loaded is not seen live afterwards. An app sign-in is a handful of rows.</summary>
    private async Task<int> RevokeAsync(System.Linq.Expressions.Expression<Func<RefreshToken, bool>> which, CancellationToken cancellationToken)
    {
        var live = await db.RefreshTokens.Where(which).Where(t => t.RevokedAt == null).ToListAsync(cancellationToken);
        var now = DateTime.UtcNow;
        foreach (var token in live) token.RevokedAt = now;
        try
        {
            await WriteSaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (SqliteBusy.IsBusy(ex))
        {
            logger.LogWarning("App sign-in write revoke locked after a busy writer");
        }
        return live.Count;
    }

    private async Task<AppSignInResult<T>> WriteAsync<T>(string action, Func<Task<AppSignInResult<T>>> write)
    {
        var previous = db.Database.GetCommandTimeout();
        db.Database.SetCommandTimeout(WriteCommandTimeoutSeconds);
        var started = Stopwatch.GetTimestamp();
        try
        {
            var result = await write();
            if (result.Outcome == AppSignInOutcome.Ok)
            {
                var elapsedMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                logger.LogInformation("App sign-in write {Action}: {ElapsedMs}ms", action, elapsedMs);
            }
            return result;
        }
        catch (Exception ex) when (SqliteBusy.IsBusy(ex))
        {
            var elapsedMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            logger.LogWarning("App sign-in write {Action} locked after {ElapsedMs}ms", action, elapsedMs);
            return AppSignInResult.Fail<T>(AppSignInOutcome.Busy, "temporarily_unavailable",
                "The stats database is busy updating; try again in a minute");
        }
        finally
        {
            db.Database.SetCommandTimeout(previous);
        }
    }

    private async Task WriteSaveChangesAsync(CancellationToken cancellationToken)
    {
        var previous = db.Database.GetCommandTimeout();
        db.Database.SetCommandTimeout(WriteCommandTimeoutSeconds);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            db.Database.SetCommandTimeout(previous);
        }
    }

    private AppTokenResponse Answer(User user, string rawRefresh, RefreshToken entity)
    {
        var (accessToken, expiresAt) = tokens.CreateAccessToken(user);
        return new AppTokenResponse(accessToken, ToInstant(expiresAt), rawRefresh, ToInstant(entity.ExpiresAt), new AppTokenUser(user.Id, DisplayName(user)));
    }

    /// <summary>The account's sign-in name; a Discord account has none, so its address, or its id.</summary>
    internal static string DisplayName(User user)
    {
        if (!string.IsNullOrWhiteSpace(user.Username)) return user.Username;
        var email = AccountService.MaskStoredEmail(user.Email);
        return email.Length > 0 ? email : $"Account {user.Id}";
    }

    /// <summary>RefreshToken times are UTC DateTimes; SQLite hands them back unspecified.</summary>
    private static Instant ToInstant(DateTime value) =>
        Instant.FromDateTimeUtc(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static AppSignInResult<T> Refuse<T>(string message) =>
        AppSignInResult.Fail<T>(AppSignInOutcome.InvalidRequest, InvalidRequest, message);

    private static AppSignInResult<AppTokenResponse> Grant(string message) =>
        AppSignInResult.Fail<AppTokenResponse>(AppSignInOutcome.InvalidGrant, InvalidGrant, message);
}
