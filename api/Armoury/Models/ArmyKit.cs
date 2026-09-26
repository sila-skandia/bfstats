namespace api.Armoury.Models;

/// <summary>
/// One kit an army spawns with, as its level declares it, pointed at the in-game icon.
/// </summary>
/// <param name="Template">Kit template the level names, e.g. "Rus_Assault".</param>
/// <param name="Name">Display name, e.g. "Assault".</param>
/// <param name="Role">"scout", "assault", "at", "medic", "engineer", or null outside the stock five.</param>
/// <param name="IconPath">Path under the HUD asset route, e.g. "kits/bf1942/rusassault.png", or null.</param>
public record ArmyKit(string Template, string Name, string? Role, string? IconPath);
