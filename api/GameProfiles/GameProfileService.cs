using System.Diagnostics;
using System.Text.Json;
using api.GameProfiles.Models;
using api.PlayerTracking;
using api.StatsCollectors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.GameProfiles;

/// <summary>
/// An account holds at most <see cref="GameProfileRules.MaxProfiles"/> profiles, so every
/// write reads all of them and settles which one is active in memory: exactly one is
/// active whenever there are any.
/// </summary>
public class GameProfileService(
    PlayerTrackerDbContext context,
    IClock clock,
    ILogger<GameProfileService> logger) : IGameProfileService
{
    public async Task<IReadOnlyList<GameProfileResponse>> ListAsync(int userId, CancellationToken cancellationToken = default)
    {
        var profiles = await context.GameProfiles.AsNoTracking()
            .Where(p => p.UserId == userId)
            .ToListAsync(cancellationToken);
        return profiles
            .OrderBy(p => p.NormalizedName, StringComparer.Ordinal)
            .Select(ToResponse)
            .ToList();
    }

    public async Task<GameProfileResult> UpsertAsync(
        int userId, string name, UpsertGameProfileRequest request, CancellationToken cancellationToken = default)
    {
        if (GameProfileRules.ValidateName(name) is { } nameError)
            return GameProfileResult.Fail(GameProfileOutcome.Invalid, nameError);

        var (files, filesError) = GameProfileRules.ValidateFiles(request.Files);
        if (files is null)
            return GameProfileResult.Fail(GameProfileOutcome.Invalid, filesError!);

        if (request.HasSidecarName)
        {
            var (_, sidecarError) = GameProfileRules.ValidateSidecarName(request.SidecarName);
            if (sidecarError is not null)
                return GameProfileResult.Fail(GameProfileOutcome.Invalid, sidecarError);
        }

        return await WriteAsync("upsert", name, async () =>
        {
            var profiles = await LoadAsync(userId, cancellationToken);
            var normalized = Normalize(name);
            var existing = profiles.FirstOrDefault(p => p.NormalizedName == normalized);

            // Given, else the file's, else what the profile already had, else the folder's name
            // (the game names a new profile after its player).
            var playerName = request.PlayerName?.Trim() is { Length: > 0 } given
                ? given
                : GameProfileRules.ReadPlayerName(files.GetValueOrDefault(GameProfileRules.GeneralOptionsFile))
                  ?? existing?.PlayerName
                  ?? name;
            if (GameProfileRules.ValidatePlayerName(playerName) is { } playerError)
                return GameProfileResult.Fail(GameProfileOutcome.Invalid, playerError);

            // Only a body that names sidecarName changes it: a re-import or the viewer's save keeps it.
            var sidecarName = existing?.SidecarName;
            if (request.HasSidecarName)
                (sidecarName, _) = GameProfileRules.ValidateSidecarName(request.SidecarName);

            if (existing is null && profiles.Count >= GameProfileRules.MaxProfiles)
                return GameProfileResult.Fail(GameProfileOutcome.LimitReached,
                    $"An account holds at most {GameProfileRules.MaxProfiles} profiles; delete one first");

            var now = clock.GetCurrentInstant();
            var profile = existing;
            if (profile is null)
            {
                profile = new GameProfile { UserId = userId, CreatedAt = now };
                context.GameProfiles.Add(profile);
                profiles.Add(profile);
            }

            // Re-importing under another case renames it to the folder as it is now.
            profile.Name = name;
            profile.NormalizedName = normalized;
            profile.PlayerName = playerName;
            profile.SidecarName = sidecarName;
            profile.FilesJson = JsonSerializer.Serialize(files);
            profile.UpdatedAt = now;

            if (request.MakeActive || !profiles.Any(p => p.IsActive))
                SetActive(profiles, profile);

            await context.SaveChangesAsync(cancellationToken);
            return GameProfileResult.Ok(ToResponse(profile));
        });
    }

    public Task<GameProfileResult> ActivateAsync(int userId, string name, CancellationToken cancellationToken = default) =>
        WriteAsync("activate", name, async () =>
        {
            var profiles = await LoadAsync(userId, cancellationToken);
            var normalized = Normalize(name);
            var profile = profiles.FirstOrDefault(p => p.NormalizedName == normalized);
            if (profile is null) return GameProfileResult.Fail(GameProfileOutcome.NotFound, "Profile not found");

            SetActive(profiles, profile);
            await context.SaveChangesAsync(cancellationToken);
            return GameProfileResult.Ok(ToResponse(profile));
        });

    public async Task<GameProfileResult> SetSidecarNameAsync(
        int userId, string name, string? sidecarName, CancellationToken cancellationToken = default)
    {
        var (value, error) = GameProfileRules.ValidateSidecarName(sidecarName);
        if (error is not null) return GameProfileResult.Fail(GameProfileOutcome.Invalid, error);

        return await WriteAsync("sidecar", name, async () =>
        {
            var normalized = Normalize(name);
            var profile = await context.GameProfiles
                .FirstOrDefaultAsync(p => p.UserId == userId && p.NormalizedName == normalized, cancellationToken);
            if (profile is null) return GameProfileResult.Fail(GameProfileOutcome.NotFound, "Profile not found");

            // UpdatedAt is left alone: it says when the files last changed, and picks the
            // next active profile on a delete.
            profile.SidecarName = value;
            await context.SaveChangesAsync(cancellationToken);
            return GameProfileResult.Ok(ToResponse(profile));
        });
    }

    public Task<GameProfileResult> DeleteAsync(int userId, string name, CancellationToken cancellationToken = default) =>
        WriteAsync("delete", name, async () =>
        {
            var profiles = await LoadAsync(userId, cancellationToken);
            var normalized = Normalize(name);
            var profile = profiles.FirstOrDefault(p => p.NormalizedName == normalized);
            if (profile is null) return GameProfileResult.Fail(GameProfileOutcome.NotFound, "Profile not found");

            context.GameProfiles.Remove(profile);
            profiles.Remove(profile);
            // Instants compared in memory: their stored ExtendedIso text does not sort.
            if (profile.IsActive && profiles.OrderByDescending(p => p.UpdatedAt).ThenByDescending(p => p.Id).FirstOrDefault() is { } next)
                SetActive(profiles, next);

            await context.SaveChangesAsync(cancellationToken);
            return GameProfileResult.Ok();
        });

    // The hourly incremental holds the one SQLite writer for ~1-2 min. CommandTimeout(60)
    // would sit on this one-row UPDATE until the Slow page fires; 5s matches busy_timeout
    // and the request returns 503 instead.
    internal const int WriteCommandTimeoutSeconds = 5;

    private async Task<GameProfileResult> WriteAsync(string action, string name, Func<Task<GameProfileResult>> write)
    {
        var previous = context.Database.GetCommandTimeout();
        context.Database.SetCommandTimeout(WriteCommandTimeoutSeconds);
        var started = Stopwatch.GetTimestamp();
        try
        {
            var result = await write();
            if (result.Outcome == GameProfileOutcome.Ok)
            {
                var elapsedMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                logger.LogInformation("Game profile write {Action} {Name}: {ElapsedMs}ms", action, name, elapsedMs);
            }
            return result;
        }
        catch (Exception ex) when (SqliteBusy.IsBusy(ex))
        {
            var elapsedMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            logger.LogWarning("Game profile write {Action} {Name} locked after {ElapsedMs}ms", action, name, elapsedMs);
            return GameProfileResult.Fail(GameProfileOutcome.Busy,
                "The stats database is busy updating; try again in a minute");
        }
        catch (DbUpdateException ex)
        {
            // Two writes of one new name at once: the unique index refused the second.
            logger.LogWarning(ex, "Game profile write {Action} {Name} lost a race", action, name);
            return GameProfileResult.Fail(GameProfileOutcome.Conflict, "The profile changed while saving; try again");
        }
        finally
        {
            context.Database.SetCommandTimeout(previous);
        }
    }

    private Task<List<GameProfile>> LoadAsync(int userId, CancellationToken cancellationToken) =>
        context.GameProfiles.Where(p => p.UserId == userId).ToListAsync(cancellationToken);

    private static void SetActive(IEnumerable<GameProfile> profiles, GameProfile active)
    {
        foreach (var p in profiles) p.IsActive = ReferenceEquals(p, active);
    }

    internal static string Normalize(string name) => name.ToUpperInvariant();

    /// <summary>A row whose files no longer parse still lists, with no files, rather than failing the list.</summary>
    internal GameProfileResponse ToResponse(GameProfile profile)
    {
        Dictionary<string, string> files;
        try
        {
            files = JsonSerializer.Deserialize<Dictionary<string, string>>(profile.FilesJson) ?? [];
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Game profile {ProfileId} has unreadable files", profile.Id);
            files = [];
        }
        return new GameProfileResponse(profile.Name, profile.PlayerName, profile.IsActive, profile.UpdatedAt, files, profile.SidecarName);
    }
}
