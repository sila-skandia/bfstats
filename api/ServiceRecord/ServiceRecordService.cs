using api.Armoury;
using api.Armoury.Models;
using api.Caching;
using api.MapDossiers;
using api.MapDossiers.Models;
using api.ServiceRecord.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace api.ServiceRecord;

/// <summary>
/// Attributes a player's sessions to armies. A team label is only ever "Axis" or "Allied",
/// but a team label on a known map is a nationality: the map's dossier names the skin and
/// flag each side fields, so Wake's Axis are the Imperial Japanese Army.
///
/// Every step that depends on asset data degrades per record — a map whose dossier is
/// missing or unreadable costs its sessions their army, not the player their record.
/// </summary>
public class ServiceRecordService(
    IServiceRecordStore store,
    IMapDossierService dossierService,
    IMapDossierResolver resolver,
    IArmouryService armouryService,
    IMeshArmouryIndex meshIndex,
    IMemoryCache memoryCache,
    ICacheService cacheService,
    ILogger<ServiceRecordService> logger) : IServiceRecordService
{
    private const int MapsPerArmy = 5;
    private const int VehiclesPerArmy = 8;

    // A career moves by a few rounds a day; a cold rebuild of a busy regular costs a second
    // or two of random reads on the production volume, so it is not repeated every ten minutes.
    private static readonly TimeSpan RecordTtl = TimeSpan.FromHours(1);

    // A heavy player touches a hundred or more maps, and each dossier read parses a file and
    // resolves its icons. Hold each (misses included) across requests.
    private static readonly TimeSpan DossierTtl = TimeSpan.FromMinutes(10);

    // Emplacements are not vehicles; unclassified mod objects are not either.
    private static readonly HashSet<string> VehicleCategories =
        new(StringComparer.OrdinalIgnoreCase) { "land", "air", "sea" };

    /// <summary>Redis key for a player's record. Bump the version when the payload changes shape.</summary>
    public static string CacheKey(string playerName) => $"service-record:v2:{playerName}";

    /// <summary>
    /// Refractor's team numbering for a bflist label: "Axis" is team 1, "Allied" (or
    /// "Allies") team 2. Anything else — numbers, blanks — is 0, no side at all.
    /// </summary>
    public static int TeamIndexOf(string? label) => (label ?? "").Trim().ToLowerInvariant() switch
    {
        "axis" => 1,
        "allied" or "allies" => 2,
        _ => 0,
    };

    public async Task<PlayerServiceRecord?> GetAsync(string playerName,
        CancellationToken cancellationToken = default)
    {
        var cacheKey = CacheKey(playerName);
        var cached = await cacheService.GetAsync<PlayerServiceRecord>(cacheKey, cancellationToken);
        if (cached is not null)
            return cached;

        if (!await store.PlayerExistsAsync(playerName, cancellationToken))
            return null;

        var rows = await store.GetRowsAsync(playerName, cancellationToken);
        var record = await BuildAsync(playerName, rows, cancellationToken);

        await cacheService.SetAsync(cacheKey, record, RecordTtl, cancellationToken);
        return record;
    }

    internal async Task<PlayerServiceRecord> BuildAsync(string playerName,
        ServiceRecordRows window, CancellationToken cancellationToken)
    {
        var rows = window.Rows;
        SideTally[] sides = [new(ArmyCatalogue.AxisSide), new(ArmyCatalogue.AlliedSide)];
        var armies = new Dictionary<string, ArmyTally>(StringComparer.OrdinalIgnoreCase);
        var unattributed = new SideTally("unattributed");
        double totalMinutes = 0;
        double attributedMinutes = 0;

        foreach (var row in rows)
        {
            totalMinutes += row.Minutes;

            var teamIndex = TeamIndexOf(row.TeamLabel);
            if (teamIndex == 0)
            {
                // A numeric or empty label names neither side.
                unattributed.Add(row);
                continue;
            }

            sides[teamIndex - 1].Add(row);

            var attribution = await AttributeAsync(row, teamIndex, cancellationToken);
            if (attribution is null)
            {
                // No dossier, or no such team in it: the side is known, the army is not.
                unattributed.Add(row);
                continue;
            }

            if (!armies.TryGetValue(attribution.Identity.Key, out var army))
            {
                army = new ArmyTally();
                armies[attribution.Identity.Key] = army;
            }

            army.Add(row, attribution);
            attributedMinutes += row.Minutes;
        }

        var composed = armies.Values
            .OrderByDescending(army => army.Minutes)
            .ThenBy(army => army.Home.Identity.Name, StringComparer.Ordinal)
            .Select(ComposeArmy)
            .ToList();

        return new PlayerServiceRecord(
            playerName,
            Round(totalMinutes),
            Round(attributedMinutes),
            [.. sides.Select(side => side.ToSide())],
            composed,
            new ServiceRecordUnattributed(Round(unattributed.Minutes), unattributed.Rounds),
            new ServiceRecordWindow(
                rows.Sum(row => row.Rounds),
                window.Capped,
                rows.Select(row => row.OldestStart).Where(start => start is not null).Min()));
    }

    private async Task<Attribution?> AttributeAsync(ServiceRecordRow row, int teamIndex,
        CancellationToken cancellationToken)
    {
        var dossier = await DossierAsync(row.GameId, row.MapName, cancellationToken);
        if (dossier is null)
            return null;

        try
        {
            var team = dossier.Teams.FirstOrDefault(candidate => candidate is not null && candidate.Index == teamIndex);
            if (team is null)
                return null;

            var identity = ArmyCatalogue.Identify(RosterMod(row.GameId, dossier.Mod), team);

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var vehicles = dossier.Arsenal
                .Where(entry => entry is not null
                                && entry.Team == teamIndex
                                && VehicleCategories.Contains(entry.Category ?? "")
                                && !string.IsNullOrWhiteSpace(entry.Template)
                                && seen.Add(entry.Template.Trim()))
                .ToList();

            return new Attribution(identity, dossier, team,
                $"{dossier.Mod}/{dossier.Map}".ToLowerInvariant(), vehicles);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not attribute {GameId}/{MapName} ({TeamLabel}) to an army",
                row.GameId, row.MapName, row.TeamLabel);
            return null;
        }
    }

    /// <summary>
    /// The mod whose roster a session's army belongs to. A Desert Combat Final server plays
    /// maps it inherits from Desert Combat, whose dossiers are filed under <c>desertcombat</c>;
    /// the player was still playing DC Final, so without this one mod's United States would
    /// read as two armies. The WWII packs share one roster whichever pack the level is from.
    /// A server whose own mod does not inherit the dossier's (a mis-reported gameId found by
    /// the resolver's fallback scan) keeps the dossier's.
    /// </summary>
    private string RosterMod(string serverGameId, string dossierMod)
    {
        if (ArmyCatalogue.FamilyOf(dossierMod) == ArmyCatalogue.WorldWarTwoFamily)
            return dossierMod;

        var serverPath = resolver.SearchPath(serverGameId);
        return serverPath.Count > 0 && serverPath.Contains(dossierMod, StringComparer.OrdinalIgnoreCase)
            ? serverPath[0]
            : dossierMod;
    }

    private async Task<MapDossier?> DossierAsync(string gameId, string mapName,
        CancellationToken cancellationToken)
    {
        var key = $"service-record:dossier:{gameId.Trim().ToLowerInvariant()}|{mapName.Trim().ToLowerInvariant()}";
        if (memoryCache.TryGetValue(key, out CachedDossier? cached) && cached is not null)
            return cached.Dossier;

        MapDossier? dossier = null;
        try
        {
            dossier = await dossierService.GetAsync(gameId, mapName, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Held as a miss like any other, so one broken file is logged once per refresh
            // rather than once per session group of every player who played it.
            logger.LogWarning(ex, "Could not load the dossier for {GameId}/{MapName}; its sessions stay unattributed",
                gameId, mapName);
        }

        memoryCache.Set(key, new CachedDossier(dossier), DossierTtl);
        return dossier;
    }

    private ServiceRecordArmy ComposeArmy(ArmyTally tally)
    {
        var home = tally.Home;
        var identity = home.Identity;
        IReadOnlyList<ArmyKit> kits = [];
        ArmyFigure? figure = null;
        IReadOnlyList<ServiceRecordVehicle> vehicles = [];

        try
        {
            // The kits and the soldier are those of the map the player served on longest.
            var described = armouryService.DescribeTeam(home.Dossier, home.Team);
            kits = described.Kits;
            figure = described.Figure;
            vehicles = MotorPool(tally);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not dress army {ArmyKey}; returning it without kits, figure or vehicles",
                identity.Key);
        }

        var maps = tally.Maps.Values
            .OrderByDescending(map => map.Minutes)
            .ThenBy(map => map.Dossier.DisplayName, StringComparer.Ordinal)
            .Take(MapsPerArmy)
            .Select(map =>
            {
                var (gameId, mapName) = map.Address;
                var displayName = string.IsNullOrWhiteSpace(map.Dossier.DisplayName) ? mapName : map.Dossier.DisplayName;
                return new ServiceRecordMap(gameId, mapName, displayName, Round(map.Minutes), map.Rounds);
            })
            .ToList();

        return new ServiceRecordArmy(
            identity.Key,
            identity.Name,
            identity.Nation,
            identity.NationLabel,
            identity.Side,
            identity.Family,
            Round(tally.Minutes),
            tally.Rounds,
            tally.Kills,
            tally.Deaths,
            tally.Score,
            tally.Wins,
            tally.Losses,
            maps,
            kits,
            figure,
            vehicles);
    }

    /// <summary>
    /// What the army fielded where the player fought: every machine a (map, team) spawns is
    /// credited with the player's minutes on it. Exposure, not use.
    /// </summary>
    private List<ServiceRecordVehicle> MotorPool(ArmyTally tally) =>
    [
        .. tally.Vehicles
            .OrderByDescending(pair => pair.Value.Minutes)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .Take(VehiclesPerArmy)
            .Select(pair => ComposeVehicle(tally, pair.Value)),
    ];

    private ServiceRecordVehicle ComposeVehicle(ArmyTally tally, VehicleTally vehicle)
    {
        // Name and category come from the map the player spent longest on; the art from the
        // first of its maps that has any.
        var fielded = vehicle.ByMap
            .OrderByDescending(pair => tally.Maps[pair.Key].Minutes)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => pair.Value)
            .ToList();

        var lead = fielded[0].Entry;
        var iconPath = fielded.Select(item => item.Entry.IconPath).FirstOrDefault(path => path is not null);

        string? thumb = null;
        string? model = null;
        var searchedMods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (entry, dossierMod) in fielded)
        {
            if (thumb is not null && model is not null)
                break;
            if (!searchedMods.Add($"{dossierMod}|{entry.Template}"))
                continue;

            var assets = meshIndex.ResolveVehicle(entry.Template, meshIndex.TreesFor(dossierMod));
            thumb ??= assets.Thumb;
            model ??= assets.Model;
        }

        return new ServiceRecordVehicle(
            lead.Template.Trim(),
            string.IsNullOrWhiteSpace(lead.Name) ? lead.Template.Trim() : lead.Name,
            (lead.Category ?? "").ToLowerInvariant(),
            iconPath,
            thumb,
            model,
            Round(vehicle.Minutes),
            vehicle.ByMap.Count);
    }

    private static double Round(double minutes) => Math.Round(minutes, 1, MidpointRounding.AwayFromZero);

    private sealed record CachedDossier(MapDossier? Dossier);

    /// <summary>A session group's army, and the vehicles its side fields on that map.</summary>
    private sealed record Attribution(
        ArmyIdentity Identity,
        MapDossier Dossier,
        MapDossierTeam Team,
        string MapKey,
        List<MapDossierArsenalEntry> Vehicles);

    private sealed class SideTally(string side)
    {
        public double Minutes { get; private set; }

        public int Rounds { get; private set; }

        private int kills;
        private int deaths;
        private int wins;
        private int losses;

        public void Add(ServiceRecordRow row)
        {
            Minutes += row.Minutes;
            Rounds += row.Rounds;
            kills += row.Kills;
            deaths += row.Deaths;
            wins += row.Wins;
            losses += row.Losses;
        }

        public ServiceRecordSide ToSide() =>
            new(side, Round(Minutes), Rounds, kills, deaths, wins, losses);
    }

    private sealed class ArmyTally
    {
        public double Minutes { get; private set; }

        public int Rounds { get; private set; }

        public int Kills { get; private set; }

        public int Deaths { get; private set; }

        public int Score { get; private set; }

        public int Wins { get; private set; }

        public int Losses { get; private set; }

        /// <summary>Keyed by the dossier's own mod/map, so "wake" and "wake island" are one map.</summary>
        public Dictionary<string, MapTally> Maps { get; } = new(StringComparer.Ordinal);

        /// <summary>Keyed by lowercased arsenal template.</summary>
        public Dictionary<string, VehicleTally> Vehicles { get; } = new(StringComparer.Ordinal);

        /// <summary>The map this army was played on longest.</summary>
        public MapTally Home => Maps.Values
            .OrderByDescending(map => map.Minutes)
            .ThenBy(map => map.Key, StringComparer.Ordinal)
            .First();

        public void Add(ServiceRecordRow row, Attribution attribution)
        {
            Minutes += row.Minutes;
            Rounds += row.Rounds;
            Kills += row.Kills;
            Deaths += row.Deaths;
            Score += row.Score;
            Wins += row.Wins;
            Losses += row.Losses;

            if (!Maps.TryGetValue(attribution.MapKey, out var map))
            {
                map = new MapTally(attribution.MapKey, attribution.Identity, attribution.Dossier, attribution.Team);
                Maps[attribution.MapKey] = map;
            }

            map.Add(row);

            foreach (var entry in attribution.Vehicles)
            {
                var key = entry.Template.Trim().ToLowerInvariant();
                if (!Vehicles.TryGetValue(key, out var vehicle))
                {
                    vehicle = new VehicleTally();
                    Vehicles[key] = vehicle;
                }

                vehicle.Minutes += row.Minutes;
                vehicle.ByMap.TryAdd(attribution.MapKey, (entry, attribution.Dossier.Mod));
            }
        }
    }

    private sealed class MapTally(string key, ArmyIdentity identity, MapDossier dossier, MapDossierTeam team)
    {
        public string Key { get; } = key;

        public ArmyIdentity Identity { get; } = identity;

        public MapDossier Dossier { get; } = dossier;

        public MapDossierTeam Team { get; } = team;

        public double Minutes { get; private set; }

        public int Rounds { get; private set; }

        // Servers report one map under several addresses ("wake", "wake island", another
        // mod's gameId); the entry links to the one the player's minutes mostly came from.
        private readonly Dictionary<(string GameId, string MapName), double> addresses = [];

        public (string GameId, string MapName) Address => addresses
            .OrderByDescending(pair => pair.Value)
            .ThenBy(pair => pair.Key.GameId, StringComparer.Ordinal)
            .ThenBy(pair => pair.Key.MapName, StringComparer.Ordinal)
            .First()
            .Key;

        public void Add(ServiceRecordRow row)
        {
            Minutes += row.Minutes;
            Rounds += row.Rounds;
            addresses[(row.GameId, row.MapName)] = addresses.GetValueOrDefault((row.GameId, row.MapName)) + row.Minutes;
        }
    }

    private sealed class VehicleTally
    {
        public double Minutes { get; set; }

        /// <summary>The first arsenal entry seen on each contributing map, and that map's dossier mod.</summary>
        public Dictionary<string, (MapDossierArsenalEntry Entry, string DossierMod)> ByMap { get; } =
            new(StringComparer.Ordinal);
    }
}
