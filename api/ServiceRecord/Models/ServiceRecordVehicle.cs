namespace api.ServiceRecord.Models;

/// <summary>
/// A machine the player's side put in the field where they fought. The minutes are
/// exposure — time spent on a (map, side) that spawns it — not time spent in it.
/// </summary>
/// <param name="Template">Arsenal template, e.g. "t34".</param>
/// <param name="Category">"land", "air" or "sea".</param>
/// <param name="IconPath">In-game icon under the HUD asset route, or null.</param>
/// <param name="Thumb">Mesh site browse render under the mesh asset route, or null.</param>
/// <param name="Model">The machine's glb under the mesh asset route, or null.</param>
/// <param name="Maps">How many of the player's maps field it.</param>
public record ServiceRecordVehicle(
    string Template,
    string Name,
    string Category,
    string? IconPath,
    string? Thumb,
    string? Model,
    double Minutes,
    int Maps);
