using System.Text.Json;
using System.Text.RegularExpressions;
using api.Armoury.Models;
using api.ImageStorage;
using api.MapDossiers;
using Microsoft.Extensions.Logging;

namespace api.Armoury;

/// <summary>
/// Resolves the mesh site's soldiers, kit parts and vehicles from in-memory listings of the
/// model trees. A service record walks a few dozen armies and a hundred maps, so probing the
/// volume per lookup would be thousands of stat calls; the trees only change when the asset
/// volume is republished, so each is listed once and held for ten minutes, exactly as
/// <see cref="MapDossierService"/> holds the HUD icon set.
///
/// A mod's extraction writes only what the mod adds — Road to Rome's tree holds its Breda
/// and bayonet grips, not the vanilla rifles its soldiers also carry — so a pose, part or
/// vehicle is looked up per file along the search path, the way the viewer's
/// <c>pose-bases.js</c> does, rather than inside one tree.
/// </summary>
public sealed partial class MeshArmouryIndex(
    IMapDossierResolver resolver,
    ILogger<MeshArmouryIndex> logger) : IMeshArmouryIndex
{
    /// <summary>The vanilla tree, <c>models/</c>.</summary>
    public const string VanillaTree = "bf1942";

    private const string PoseSuffix = ".pose.glb";
    private static readonly TimeSpan IndexTtl = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly IReadOnlyList<double> Origin = [0, 0, 0];

    private readonly Lock gate = new();
    private readonly Dictionary<string, MeshTree> trees = new(StringComparer.Ordinal);
    private DateTime indexLoadedUtc = DateTime.MinValue;

    public IReadOnlyList<string> TreesFor(string dossierMod)
    {
        var includeVanilla = ArmyCatalogue.FamilyOf(dossierMod) == ArmyCatalogue.WorldWarTwoFamily;
        var result = new List<string>();

        foreach (var entry in resolver.SearchPath(dossierMod ?? ""))
        {
            var id = entry.Trim().ToLowerInvariant();
            if (id == VanillaTree || result.Contains(id) || !SafeTreeId().IsMatch(id))
                continue;
            if (Tree(id).Exists)
                result.Add(id);
        }

        if (includeVanilla)
            result.Add(VanillaTree);

        return result;
    }

    public ArmyFigure? ResolveFigure(string? skin, IReadOnlyList<string> kitTemplates,
        IReadOnlyList<string> trees)
    {
        ArgumentNullException.ThrowIfNull(kitTemplates);
        ArgumentNullException.ThrowIfNull(trees);

        if (string.IsNullOrWhiteSpace(skin))
            return null;

        var searched = trees.Select(Tree).ToList();

        // A soldier exists when any tree on the path ships a pose for him; the first such tree
        // gives the skin its spelling.
        var figureSkin = searched
            .Select(tree => tree.PoseSkins.GetValueOrDefault(skin.Trim()))
            .FirstOrDefault(spelling => spelling is not null);
        if (figureSkin is null)
            return null;

        var kits = new List<FigureKit>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var template in kitTemplates)
        {
            if (string.IsNullOrWhiteSpace(template) || !seen.Add(template.Trim()))
                continue;

            var kit = FindKit(searched, template.Trim());
            if (kit is null)
                continue;

            var posed = FindPose(searched, figureSkin, kit);
            if (posed is null)
                continue;

            kits.Add(new FigureKit(template.Trim(), posed.Value.Weapon, posed.Value.Pose, WornParts(searched, kit)));
        }

        // A soldier with no kit the armoury can pose has nothing to draw: Eve of Destruction
        // levels that issue only parachute kits, which no kits.json lists. Null says so,
        // where an empty figure would leave the page an empty stage and no explanation.
        if (kits.Count == 0)
            return null;

        var thumb = FirstPath(searched, Slug(figureSkin) + ".png", thumbs: true);
        return new ArmyFigure(figureSkin, thumb, kits);
    }

    public VehicleAssets ResolveVehicle(string vehicleTemplate, IReadOnlyList<string> trees)
    {
        ArgumentNullException.ThrowIfNull(trees);

        if (string.IsNullOrWhiteSpace(vehicleTemplate))
            return new VehicleAssets(null, null);

        var searched = trees.Select(Tree).ToList();
        var model = FirstPath(searched, vehicleTemplate.Trim() + ".glb", thumbs: false);
        var thumb = FirstPath(searched, Slug(vehicleTemplate) + ".png", thumbs: true);
        return new VehicleAssets(thumb, model);
    }

    /// <summary>
    /// The file-name slug the mesh site's thumbnail renderer (<c>shoot.mjs</c>) writes:
    /// runs of anything but ASCII letters and digits become one dash, a leading and a
    /// trailing dash are dropped, and the result is lowercased.
    /// </summary>
    public static string Slug(string? value)
    {
        var dashed = NonAlphanumericRun().Replace(string.IsNullOrEmpty(value) ? "base" : value, "-");
        if (dashed.StartsWith('-'))
            dashed = dashed[1..];
        if (dashed.EndsWith('-'))
            dashed = dashed[..^1];
        return dashed.ToLowerInvariant();
    }

    private static MeshKit? FindKit(List<MeshTree> searched, string template)
    {
        foreach (var tree in searched)
        {
            if (tree.Kits.TryGetValue(template, out var kit))
                return kit;
        }

        return null;
    }

    /// <summary>
    /// The kit's first item with a <c>{skin}__{item}.pose.glb</c> anywhere on the path: each
    /// item is looked for in every tree in turn before the next item is tried, so a vanilla
    /// rifle posed only in <c>models/</c> still beats a mod tree's grip for the kit's third
    /// item. Matching ignores case — the manifests spell "MP18", the files "Mp18" — and the
    /// weapon is returned as the file spells it.
    /// </summary>
    private static (string Weapon, string Pose)? FindPose(List<MeshTree> poseTrees, string skin, MeshKit kit)
    {
        foreach (var item in kit.Items ?? [])
        {
            if (item is null || string.IsNullOrWhiteSpace(item.Template))
                continue;

            var wanted = $"{skin}__{item.Template.Trim()}{PoseSuffix}";
            foreach (var tree in poseTrees)
            {
                if (tree.Poses.TryGetValue(wanted, out var file))
                    return (file[(skin.Length + 2)..^PoseSuffix.Length], $"{tree.Prefix}/poses/{file}");
            }
        }

        return null;
    }

    private static List<FigureWornPart> WornParts(List<MeshTree> searched, MeshKit kit)
    {
        var parts = new List<FigureWornPart>();
        foreach (var worn in kit.Worn ?? [])
        {
            if (worn is null || string.IsNullOrWhiteSpace(worn.Glb))
                continue;

            // A mod kit borrows vanilla's radio and packs, so each part comes from the first
            // tree that has it; a part no tree has is left off rather than drawn missing.
            var path = FirstPath(searched, worn.Glb.Trim(), thumbs: false);
            if (path is null)
                continue;

            parts.Add(new FigureWornPart(path, worn.Bone, worn.Slot,
                worn.Position is { Count: > 0 } position ? position : Origin,
                worn.Rotation is { Count: > 0 } rotation ? rotation : Origin));
        }

        return parts;
    }

    private static string? FirstPath(List<MeshTree> searched, string fileName, bool thumbs)
    {
        foreach (var tree in searched)
        {
            var names = thumbs ? tree.Thumbs : tree.Files;
            if (names.TryGetValue(fileName, out var file))
                return thumbs ? $"{tree.Prefix}/thumbs/{file}" : $"{tree.Prefix}/{file}";
        }

        return null;
    }

    private MeshTree Tree(string id)
    {
        lock (gate)
        {
            if (DateTime.UtcNow - indexLoadedUtc > IndexTtl)
            {
                trees.Clear();
                indexLoadedUtc = DateTime.UtcNow;
            }

            if (trees.TryGetValue(id, out var cached))
                return cached;

            var loaded = LoadTree(id);
            trees[id] = loaded;
            return loaded;
        }
    }

    private MeshTree LoadTree(string id)
    {
        var prefix = id == VanillaTree ? "models" : $"models/mods/{id}";
        var root = Path.Combine(TournamentImagesConfig.ResolveMeshPath(), prefix);
        var tree = new MeshTree(prefix, Directory.Exists(root));
        if (!tree.Exists)
            return tree;

        ListInto(tree.Files, root, ".glb");
        ListInto(tree.Poses, Path.Combine(root, "poses"), PoseSuffix);
        ListInto(tree.Thumbs, Path.Combine(root, "thumbs"), ".png");

        foreach (var pose in tree.Poses.Values)
        {
            var separator = pose.IndexOf("__", StringComparison.Ordinal);
            if (separator > 0)
                tree.PoseSkins.TryAdd(pose[..separator], pose[..separator]);
        }

        LoadKits(tree, Path.Combine(root, "kits.json"));
        return tree;
    }

    private void ListInto(Dictionary<string, string> names, string directory, string suffix)
    {
        try
        {
            if (!Directory.Exists(directory))
                return;

            // Sorted so that, where two files differ only in case, the same one always wins.
            var files = Directory.EnumerateFiles(directory)
                .Select(Path.GetFileName)
                .OfType<string>()
                .Where(name => name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                .Order(StringComparer.Ordinal);

            foreach (var file in files)
                names.TryAdd(file, file);
        }
        catch (Exception ex)
        {
            // An unreadable directory costs the armoury its pictures, not the page; hold the
            // empty listing until the next refresh rather than retrying on every request.
            logger.LogWarning(ex, "Could not list mesh assets in {Directory}", directory);
        }
    }

    private void LoadKits(MeshTree tree, string path)
    {
        try
        {
            if (!File.Exists(path))
                return;

            using var stream = File.OpenRead(path);
            var manifest = JsonSerializer.Deserialize<MeshKitManifest>(stream, JsonOptions);
            foreach (var kit in manifest?.Kits ?? [])
            {
                if (kit is not null && !string.IsNullOrWhiteSpace(kit.Template))
                    tree.Kits.TryAdd(kit.Template.Trim(), kit);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the kit manifest {Path}", path);
        }
    }

    [GeneratedRegex("[^a-zA-Z0-9]+")]
    private static partial Regex NonAlphanumericRun();

    // Mod ids become path segments; the manifest is trusted, but a stray "../" is not.
    [GeneratedRegex("^[a-z0-9_-]+$")]
    private static partial Regex SafeTreeId();

    /// <summary>One model tree's listings. Names are keyed without case and map to the file's own spelling.</summary>
    private sealed class MeshTree(string prefix, bool exists)
    {
        public string Prefix { get; } = prefix;

        public bool Exists { get; } = exists;

        /// <summary>glb files at the tree's root: vehicles, weapons and worn kit parts.</summary>
        public Dictionary<string, string> Files { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, string> Poses { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Every skin with at least one monolithic pose, as the files spell it.</summary>
        public Dictionary<string, string> PoseSkins { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, string> Thumbs { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, MeshKit> Kits { get; } = new(StringComparer.OrdinalIgnoreCase);
    }
}
