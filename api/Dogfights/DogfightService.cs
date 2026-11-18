using api.Dogfights.Models;
using api.Utils;
using NodaTime.Text;

namespace api.Dogfights;

public sealed class DogfightService(DogfightIndex index) : IDogfightService
{
    public const int DefaultPageSize = 6;
    public const int MaxPageSize = 48;

    public async Task<PagedDogfightsDto> ListAsync(
        string? server, string? player, string? kind, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = pageSize is < 1 or > MaxPageSize ? DefaultPageSize : pageSize;
        IEnumerable<DogfightDto> fights = await AllAsync(ct);
        if (!string.IsNullOrWhiteSpace(server))
        {
            var names = BothForms(server.Trim());
            fights = fights.Where(f => names.Contains(f.ServerName));
        }
        if (!string.IsNullOrWhiteSpace(player))
        {
            var names = BothForms(player.Trim());
            fights = fights.Where(f => f.Sides.Any(s => names.Contains(s.Name)));
        }
        var matching = fights.ToList();
        var dogfights = matching.Count(f => f.Kind == "dogfight");
        var kills = matching.Count(f => f.Kill is not null);
        if (!string.IsNullOrWhiteSpace(kind)) matching = [.. matching.Where(f => string.Equals(f.Kind, kind.Trim(), StringComparison.OrdinalIgnoreCase))];
        var items = matching
            .OrderByDescending(f => f.Kind == "dogfight")
            .ThenByDescending(f => f.Kill is not null)
            .ThenByDescending(f => f.Recorded)
            .ThenByDescending(f => f.Duration)
            .ThenBy(f => f.Id, StringComparer.Ordinal)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();
        return new PagedDogfightsDto(items, matching.Count, page, pageSize, dogfights, kills);
    }

    public async Task<IReadOnlyList<DogfightDto>> AllAsync(CancellationToken ct) =>
        [.. (await index.RowsAsync(ct)).Select(ToDto)];

    internal static DogfightDto ToDto(DogfightIndexRow r) => new(
        r.Id,
        r.Slug,
        string.IsNullOrEmpty(r.Mod) ? "bf1942" : r.Mod,
        r.Level ?? "",
        r.Recorded is { Length: >= 10 } date && LocalDatePattern.Iso.Parse(date[..10]) is { Success: true } parsed ? parsed.Value : null,
        r.Server ?? "",
        r.Source,
        r.Duration,
        r.Kind,
        r.Mutual,
        r.Closest,
        r.Kill,
        r.End,
        r.Sides,
        r.Clip);

    private static HashSet<string> BothForms(string name) =>
        new([name, PlayerNameDecoder.ToRecording(name), PlayerNameDecoder.FromRecording(name)], StringComparer.Ordinal);
}
