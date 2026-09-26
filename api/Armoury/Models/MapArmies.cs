namespace api.Armoury.Models;

/// <summary>
/// The two armies of one map, for the round report's header.
/// </summary>
/// <param name="Mod">Mod folder the level's dossier was found in.</param>
/// <param name="Map">Level folder name, e.g. "wake".</param>
/// <param name="DisplayName">e.g. "Wake".</param>
/// <param name="Teams">Team 1 first.</param>
public record MapArmies(string Mod, string Map, string DisplayName, IReadOnlyList<MapArmy> Teams);
