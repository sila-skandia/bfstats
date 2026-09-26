using System.Text.Json;
using api.Data.Entities;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;

namespace api.ServiceRecord;

/// <summary>
/// How far <see cref="TeamMapStatsAggregator"/> has got, kept in <c>app_data</c> so a
/// restart resumes rather than starts over.
/// </summary>
/// <param name="RefreshedThrough">Every session last seen before this is reflected, from <paramref name="OldestMonth"/> on.</param>
/// <param name="OldestMonth">The oldest month rebuilt in full, "yyyy-MM"; the backfill walks back from here.</param>
/// <param name="Complete">The backfill has reached the month of the earliest session. Until it has, the
/// table holds only the newest months and the service record keeps to its live window.</param>
public record TeamMapStatsState(Instant RefreshedThrough, AggregateMonth OldestMonth, bool Complete)
{
    public const string Key = "aggregate:player-team-map-stats";

    private sealed record Stored(string RefreshedThrough, string OldestMonth, bool Complete);

    /// <summary>The saved state, or null before the first refresh (or if the row is unreadable).</summary>
    public static async Task<TeamMapStatsState?> LoadAsync(PlayerTrackerDbContext dbContext,
        CancellationToken cancellationToken = default)
    {
        var row = await dbContext.AppData.AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.Id == Key, cancellationToken);
        if (row is null)
            return null;

        try
        {
            var stored = JsonSerializer.Deserialize<Stored>(row.Value);
            var through = InstantPattern.ExtendedIso.Parse(stored?.RefreshedThrough ?? "");
            if (stored is null || !through.Success || !AggregateMonth.TryParse(stored.OldestMonth, out var oldest))
                return null;

            return new TeamMapStatsState(through.Value, oldest, stored.Complete);
        }
        catch (JsonException)
        {
            // Treated as never run: the next refresh rebuilds from the current month back.
            return null;
        }
    }

    public async Task SaveAsync(PlayerTrackerDbContext dbContext, Instant now,
        CancellationToken cancellationToken = default)
    {
        var value = JsonSerializer.Serialize(new Stored(
            InstantPattern.ExtendedIso.Format(RefreshedThrough), OldestMonth.ToString(), Complete));

        var row = await dbContext.AppData.FirstOrDefaultAsync(entry => entry.Id == Key, cancellationToken);
        if (row is null)
        {
            dbContext.AppData.Add(new AppData { Id = Key, Value = value, UpdatedAt = now.ToDateTimeUtc() });
        }
        else
        {
            row.Value = value;
            row.UpdatedAt = now.ToDateTimeUtc();
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
