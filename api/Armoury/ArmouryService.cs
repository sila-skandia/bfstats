using api.Armoury.Models;
using api.MapDossiers;
using api.MapDossiers.Models;
using Microsoft.Extensions.Logging;

namespace api.Armoury;

/// <summary>
/// Turns a map dossier's two teams into armies a page can draw: the catalogue names them,
/// the mesh index finds the soldier and kit parts, and the dossier supplies the kit icons.
/// </summary>
public class ArmouryService(
    IMapDossierService dossierService,
    IMeshArmouryIndex meshIndex,
    ILogger<ArmouryService> logger) : IArmouryService
{
    public async Task<MapArmies?> GetMapArmiesAsync(string gameId, string mapName,
        CancellationToken cancellationToken = default)
    {
        var dossier = await dossierService.GetAsync(gameId, mapName, cancellationToken);
        if (dossier is null)
            return null;

        var teams = dossier.Teams
            .Where(team => team is not null)
            .OrderBy(team => team.Index)
            .Select(team => DescribeTeam(dossier, team))
            .ToList();

        return new MapArmies(dossier.Mod, dossier.Map, dossier.DisplayName, teams);
    }

    public MapArmy DescribeTeam(MapDossier dossier, MapDossierTeam team)
    {
        ArgumentNullException.ThrowIfNull(dossier);
        ArgumentNullException.ThrowIfNull(team);

        var identity = ArmyCatalogue.Identify(dossier.Mod, team);
        var kits = KitsOf(team);

        ArmyFigure? figure = null;
        try
        {
            figure = meshIndex.ResolveFigure(team.Skin, [.. kits.Select(kit => kit.Template)],
                meshIndex.TreesFor(dossier.Mod));
        }
        catch (Exception ex)
        {
            // The figure is decoration on top of the army's name and kits; losing it must
            // not cost the caller the rest.
            logger.LogWarning(ex, "Could not resolve the figure for {Skin} on {Mod}/{Map}",
                team.Skin, dossier.Mod, dossier.Map);
        }

        return new MapArmy(team.Index, identity.Side, identity.Key, identity.Name, identity.Nation,
            identity.NationLabel, kits, figure);
    }

    private static List<ArmyKit> KitsOf(MapDossierTeam team) =>
    [
        .. (team.Kits ?? [])
            .Where(kit => kit is not null && !string.IsNullOrWhiteSpace(kit.Template))
            .Select(kit => new ArmyKit(kit.Template, kit.Name, kit.Role, kit.IconPath)),
    ];
}
