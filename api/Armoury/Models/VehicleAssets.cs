namespace api.Armoury.Models;

/// <summary>
/// The mesh site's own assets for a machine, relative to the mesh asset root. Either may
/// be null; a caller with neither keeps the in-game HUD icon.
/// </summary>
/// <param name="Thumb">Browse render, e.g. "models/thumbs/t34.png".</param>
/// <param name="Model">The machine itself, e.g. "models/T34.glb".</param>
public record VehicleAssets(string? Thumb, string? Model);
