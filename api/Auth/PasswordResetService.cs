using System.Security.Cryptography;
using System.Text;
using api.Auth.Models;
using api.Caching;
using api.DiscordNotifications;
using api.DiscordNotifications.Models;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.Auth;

/// <summary>
/// Password reset by email (features/password-reset). Password accounts keep only an
/// HMAC of their address, so the link goes to the address the requester typed, and only
/// once it hashes to the stored value. Accounts with no address, or a requester who
/// typed the wrong one, become a Discord notice to the owner instead.
/// </summary>
public class PasswordResetService(
    PlayerTrackerDbContext db,
    IEmailHashService emailHashService,
    IPasswordHashService passwordHashService,
    IEmailSender emailSender,
    IDiscordWebhookService discord,
    ICacheService cache,
    IClock clock,
    IConfiguration configuration,
    ILogger<PasswordResetService> logger) : IPasswordResetService
{
    public static readonly Duration LinkLifetime = Duration.FromMinutes(30);

    /// <summary>One email per account per window: a typed-in address cannot be flooded.</summary>
    public static readonly TimeSpan EmailCooldown = TimeSpan.FromMinutes(2);

    /// <summary>One owner notice per account per window.</summary>
    public static readonly TimeSpan HelpCooldown = TimeSpan.FromHours(1);

    public const int MinPasswordLength = 8;

    private string SiteBaseUrl => (configuration["PasswordReset:SiteBaseUrl"] ?? "https://bfstats.io").TrimEnd('/');

    public async Task RequestAsync(string? username, string? email, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(username)) return;
        var name = username.Trim().ToLowerInvariant();

        var user = await db.Users.FirstOrDefaultAsync(u =>
            u.AuthProvider == "password" && u.Username != null && u.Username.ToLower() == name, cancellationToken);
        if (user is null || !user.IsActive || AccountService.IsTombstoned(user)) return;

        if (!emailHashService.IsHashedEmail(user.Email))
        {
            await AskOwnerAsync(user, PasswordResetHelpReason.NoEmailOnAccount, cancellationToken);
            return;
        }
        if (string.IsNullOrWhiteSpace(email) || !emailHashService.Matches(email, user.Email))
        {
            await AskOwnerAsync(user, PasswordResetHelpReason.EmailDidNotMatch, cancellationToken);
            return;
        }

        var cooldownKey = $"pwreset_email:{user.Id}";
        if (await cache.GetAsync<CooldownMarker>(cooldownKey, cancellationToken) is not null)
        {
            logger.LogInformation("Password reset for user {UserId} asked again inside the cooldown; no email sent", user.Id);
            return;
        }
        await cache.SetAsync(cooldownKey, new CooldownMarker(), EmailCooldown, cancellationToken);

        var token = await IssueLinkAsync(user.Id, cancellationToken);
        var url = $"{SiteBaseUrl}/auth/reset-password?token={token}";
        try
        {
            await emailSender.SendAsync(
                PasswordResetEmail.Build(email.Trim(), user.Username!, url, SiteBaseUrl, (int)LinkLifetime.TotalMinutes),
                cancellationToken);
            logger.LogInformation("Password reset link sent for user {UserId}", user.Id);
        }
        catch (Exception ex) when (ex is EmailDeliveryException or HttpRequestException or TaskCanceledException)
        {
            // The requester still hears the uniform answer; the owner sees this in Seq.
            logger.LogError(ex, "Password reset email for user {UserId} could not be sent", user.Id);
        }
    }

    public async Task<PasswordResetOutcome> ResetAsync(string? token, string? newPassword, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(newPassword) || newPassword.Length < MinPasswordLength)
            return PasswordResetOutcome.WeakPassword;
        if (string.IsNullOrEmpty(token) || token.Length > 128)
            return PasswordResetOutcome.InvalidLink;

        var hash = HashToken(token);
        var row = await db.PasswordResetTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
        if (row is null) return PasswordResetOutcome.InvalidLink;

        var now = clock.GetCurrentInstant();
        if (row.UsedAt is not null || now >= row.ExpiresAt) return PasswordResetOutcome.InvalidLink;

        // Claim before changing anything: the update only matches while UsedAt is null,
        // so two tabs racing the same link cannot both set a password.
        var claimed = await db.PasswordResetTokens
            .Where(t => t.Id == row.Id && t.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.UsedAt, (Instant?)now), cancellationToken);
        if (claimed == 0) return PasswordResetOutcome.InvalidLink;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == row.UserId, cancellationToken);
        if (user is null || user.AuthProvider != "password" || AccountService.IsTombstoned(user))
            return PasswordResetOutcome.InvalidLink;

        user.PasswordHash = passwordHashService.Hash(newPassword);
        await db.SaveChangesAsync(cancellationToken);

        // Whoever had the old password is signed out everywhere, and any other link
        // still in a mailbox dies with it.
        await db.RefreshTokens
            .Where(rt => rt.UserId == user.Id && rt.RevokedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(rt => rt.RevokedAt, DateTime.UtcNow), cancellationToken);
        await db.PasswordResetTokens
            .Where(t => t.UserId == user.Id && t.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.UsedAt, (Instant?)now), cancellationToken);

        logger.LogInformation("Password reset through an emailed link for user {UserId}; all sessions revoked", user.Id);
        return PasswordResetOutcome.Reset;
    }

    private async Task<string> IssueLinkAsync(int userId, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();

        // Only the newest link works, and this user's old rows go. Few rows, filtered
        // here because stored instants are ExtendedIso strings, not comparable as text.
        var previous = await db.PasswordResetTokens.Where(t => t.UserId == userId).ToListAsync(cancellationToken);
        db.PasswordResetTokens.RemoveRange(previous);

        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            TokenHash = HashToken(token),
            UserId = userId,
            CreatedAt = now,
            ExpiresAt = now + LinkLifetime,
        });
        await db.SaveChangesAsync(cancellationToken);
        return token;
    }

    private async Task AskOwnerAsync(User user, PasswordResetHelpReason reason, CancellationToken cancellationToken)
    {
        var key = $"pwreset_help:{user.Id}";
        if (await cache.GetAsync<CooldownMarker>(key, cancellationToken) is not null)
        {
            // Said plainly, so a requester who tries again and hears nothing is explained in the log.
            logger.LogInformation(
                "Password reset for user {UserId} cannot be emailed ({Reason}); the owner was already asked within the hour, no new notice",
                user.Id, reason);
            return;
        }
        await cache.SetAsync(key, new CooldownMarker(), HelpCooldown, cancellationToken);

        logger.LogInformation("Password reset for user {UserId} cannot be emailed ({Reason}); asking the owner", user.Id, reason);
        await discord.SendPasswordResetHelpAsync(new PasswordResetHelpRequest(user.Id, user.Username!, reason));
    }

    public static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record CooldownMarker;
}
