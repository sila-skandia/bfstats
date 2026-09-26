using api.Armoury.Models;
using api.MapDossiers.Models;

namespace api.Armoury;

public interface IArmouryService
{
    /// <summary>
    /// The two armies of a map, addressed the way bflist reports it, or null when the map
    /// has no dossier.
    /// </summary>
    Task<MapArmies?> GetMapArmiesAsync(string gameId, string mapName, CancellationToken cancellationToken = default);

    /// <summary>
    /// One dossier team as an army: its identity, the kits its level hands out, and the
    /// figure to draw, resolved through the dossier mod's model trees.
    /// </summary>
    MapArmy DescribeTeam(MapDossier dossier, MapDossierTeam team);
}
