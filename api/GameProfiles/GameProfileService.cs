using System.Text.Json;
using api.GameProfiles.Models;
using api.PlayerTracking;
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
        profile.FilesJson = JsonSerializer.Serialize(files);
        profile.UpdatedAt = now;

        if (request.MakeActive || !profiles.Any(p => p.IsActive))
            SetActive(profiles, profile);

        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            // Two writes of one new name at once: the unique index refused the second.
            logger.LogWarning(ex, "Game profile write for user {UserId} lost a race", userId);
            return GameProfileResult.Fail(GameProfileOutcome.Conflict, "The profile changed while saving; try again");
        }

        return GameProfileResult.Ok(ToResponse(profile));
    }

    public async Task<GameProfileResult> ActivateAsync(int userId, string name, CancellationToken cancellationToken = default)
    {
        var profiles = await LoadAsync(userId, cancellationToken);
        var normalized = Normalize(name);
        var profile = profiles.FirstOrDefault(p => p.NormalizedName == normalized);
        if (profile is null) return GameProfileResult.Fail(GameProfileOutcome.NotFound, "Profile not found");

        SetActive(profiles, profile);
        await context.SaveChangesAsync(cancellationToken);
        return GameProfileResult.Ok(ToResponse(profile));
    }

    public async Task<GameProfileResult> DeleteAsync(int userId, string name, CancellationToken cancellationToken = default)
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
        return new GameProfileResponse(profile.Name, profile.PlayerName, profile.IsActive, profile.UpdatedAt, files);
    }
}
