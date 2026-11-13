namespace api.Signatures;

/// <summary>Numbers as a signature shows them: short, so four fit on one row.</summary>
public static class Format
{
    public static string Count(long value) => value switch
    {
        >= 1_000_000 => $"{value / 1_000_000.0:0.##}M",
        >= 100_000 => $"{value / 1_000.0:0}K",
        >= 10_000 => $"{value / 1_000.0:0.#}K",
        _ => value.ToString("N0")
    };

    public static string Hours(double hours) => hours switch
    {
        >= 10_000 => $"{hours / 1000:0.#}K",
        >= 1000 => $"{hours / 1000:0.##}K",
        _ => ((int)hours).ToString("N0")
    };
}
