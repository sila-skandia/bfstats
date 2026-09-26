using api.Armoury.Models;

namespace api.Armoury;

/// <summary>
/// Finds the extracted soldiers, kit parts and vehicles the mesh site publishes, so the
/// main site can draw an army without probing for files. Trees are addressed by mod:
/// "bf1942" is <c>models/</c>, any other mod <c>models/mods/{mod}/</c>.
/// </summary>
public interface IMeshArmouryIndex
{
    /// <summary>
    /// The model trees a level from <paramref name="dossierMod"/> draws from, most specific
    /// first: the dossier's mod search path, keeping only the trees that exist. Vanilla's
    /// <c>models/</c> is part of it only for the three WWII packs — a Desert Combat or
    /// Forgotten Hope soldier is not the WWII soldier of the same template name.
    /// </summary>
    IReadOnlyList<string> TreesFor(string dossierMod);

    /// <summary>
    /// The figure for <paramref name="skin"/> holding each of <paramref name="kitTemplates"/>,
    /// or null when no tree in <paramref name="trees"/> has a pose for that skin or for any of
    /// its kits. Each kit's weapon is its first item posed anywhere on the path; a kit with
    /// none is left out.
    /// </summary>
    ArmyFigure? ResolveFigure(string? skin, IReadOnlyList<string> kitTemplates, IReadOnlyList<string> trees);

    /// <summary>The browse thumbnail and model for an arsenal template, searched across <paramref name="trees"/>.</summary>
    VehicleAssets ResolveVehicle(string vehicleTemplate, IReadOnlyList<string> trees);
}
