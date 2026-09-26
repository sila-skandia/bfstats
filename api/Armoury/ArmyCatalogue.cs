using System.Text.RegularExpressions;
using api.Armoury.Models;
using api.MapDossiers.Models;

namespace api.Armoury;

/// <summary>
/// Names the army a dossier team fields. bflist only ever says "Axis" or "Allied"; the
/// level's own team skin and flag say whether that was the Afrika Korps or the Red Army.
///
/// The three WWII packs share one roster, so a Wehrmacht soldier on a Secret Weapons map is
/// the same army as on a vanilla one. Eve of Destruction has its own curated roster. Every
/// other mod groups by nation rather than skin: FHSW alone fields GermanSoldier,
/// FMGermanSoldier and VolkssturmSoldier, which would otherwise read as three armies all
/// called "Germany". See features/service-record/README.md, "Army identity".
/// </summary>
public static partial class ArmyCatalogue
{
    public const string WorldWarTwoFamily = "bf1942";
    public const string EveOfDestructionFamily = "eod";
    public const string AxisSide = "axis";
    public const string AlliedSide = "allied";

    private sealed record CuratedSkin(string Skin, string Name);

    // Keyed case-insensitively and re-emitted in the table's own spelling: the engine reads
    // template names without regard to case, and one EoD level spells its Viet Cong
    // "VietcongSoldier", which is still the same soldier.
    private static readonly Dictionary<string, CuratedSkin> WorldWarTwoSkins = Curate(
        ("GermanSoldier", "Wehrmacht"),
        ("GermanDesertSoldier", "Afrika Korps"),
        // "German Elite" and "British Commandos" are the Secret Weapons kit manifest's own names.
        ("GermanEliteSoldier", "German Elite"),
        ("JapaneseSoldier", "Imperial Japanese Army"),
        ("ItalianSoldier", "Italian Army"),
        ("FrenchSoldier", "Free French"),
        ("BritishSoldier", "British Army"),
        ("BritishCommandoSoldier", "British Commandos"),
        ("USSoldier", "US Army"),
        ("USMarineSoldier", "US Marine Corps"),
        ("RussianSoldier", "Red Army"),
        ("CanadianSoldier", "Canadian Army"));

    private static readonly Dictionary<string, CuratedSkin> EveOfDestructionSkins = Curate(
        ("USSoldier", "US Army"),
        ("NVASoldier", "North Vietnamese Army"),
        ("VietCongSoldier", "Viet Cong"),
        ("VCFemaleSoldier", "Viet Cong"),
        ("CivilVC_Soldier", "Viet Cong"),
        ("SpecialForces", "Special Forces"),
        ("ARVNForces", "ARVN"),
        ("NavySeals", "Navy SEALs"),
        ("AustralianForces", "Australian Army"),
        ("PathetLaosSoldier", "Pathet Lao"),
        ("FrenchSoldier", "French Union"));

    /// <summary>
    /// The roster a mod's armies belong to: the three WWII packs are one, Eve of
    /// Destruction is its own, and every other mod stands alone.
    /// </summary>
    public static string FamilyOf(string? mod)
    {
        var normalized = (mod ?? "").Trim().ToLowerInvariant();
        return normalized switch
        {
            "bf1942" or "xpack1" or "xpack2" => WorldWarTwoFamily,
            _ => normalized,
        };
    }

    /// <summary>Refractor's convention, which every dossier assumes: team 1 is the Axis.</summary>
    public static string SideOf(int teamIndex) => teamIndex == 1 ? AxisSide : AlliedSide;

    /// <summary>Who <paramref name="team"/> is on a level from <paramref name="dossierMod"/>.</summary>
    public static ArmyIdentity Identify(string? dossierMod, MapDossierTeam team)
    {
        ArgumentNullException.ThrowIfNull(team);

        var family = FamilyOf(dossierMod);
        var nation = string.IsNullOrWhiteSpace(team.Nation) ? null : team.Nation.Trim();
        var label = (team.Label ?? "").Trim();
        var skin = string.IsNullOrWhiteSpace(team.Skin) ? null : team.Skin.Trim();

        string key;
        string name;

        if (family is WorldWarTwoFamily or EveOfDestructionFamily)
        {
            var table = family == WorldWarTwoFamily ? WorldWarTwoSkins : EveOfDestructionSkins;
            var curated = skin is not null && table.TryGetValue(skin, out var found) ? found : null;

            // The key keeps the nation: EoD's North Vietnamese on a map flagged "rus" stay a
            // separate army from those on an unflagged one, even though both are named alike.
            key = $"{family}:{KeyPart(nation) ?? "-"}:{curated?.Skin ?? skin ?? KeyPart(label) ?? "-"}";
            name = curated?.Name ?? Fallback(label, skin, team.Index);

            if (curated?.Skin == "BritishSoldier" && family == WorldWarTwoFamily
                && string.Equals(nation, "can", StringComparison.OrdinalIgnoreCase))
            {
                // Liberation of Caen dresses its Canadians in the British uniform and flies
                // the Canadian flag over them.
                name = "Canadian Army";
            }
        }
        else
        {
            // Labels such as bf1918's "Kuk" and "kuk" are one army; fold the case.
            key = $"{family}:{(KeyPart(nation) ?? KeyPart(label) ?? "-").ToLowerInvariant()}";
            name = label.Length > 0 ? label : Fallback(label, skin, team.Index);
        }

        return new ArmyIdentity(key, name, nation, label, SideOf(team.Index), family);
    }

    /// <summary>
    /// "SpecialForces" -> "Special Forces", "ARVNForces" -> "ARVN Forces",
    /// "CivilVC_Soldier" -> "Civil VC Soldier". Already spaced text is left alone.
    /// </summary>
    public static string Humanise(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        var spaced = WordBoundary().Replace(value.Replace('_', ' '), " ");
        return MultipleSpaces().Replace(spaced, " ").Trim();
    }

    private static string Fallback(string label, string? skin, int teamIndex)
    {
        if (label.Length > 0)
            return Humanise(label);
        if (skin is not null)
            return Humanise(skin);
        return $"Team {teamIndex}";
    }

    private static string? KeyPart(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static Dictionary<string, CuratedSkin> Curate(params (string Skin, string Name)[] entries)
    {
        var table = new Dictionary<string, CuratedSkin>(StringComparer.OrdinalIgnoreCase);
        foreach (var (skin, name) in entries)
            table[skin] = new CuratedSkin(skin, name);
        return table;
    }

    // Lower-or-digit followed by upper ("SpecialForces"), an acronym followed by a word
    // ("ARVNForces"), and a letter followed by a digit ("Soldier16").
    [GeneratedRegex("(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])")]
    private static partial Regex WordBoundary();

    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex MultipleSpaces();
}
