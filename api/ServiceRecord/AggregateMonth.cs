using System.Globalization;
using NodaTime;

namespace api.ServiceRecord;

/// <summary>A calendar month in UTC, as PlayerTeamMapStats buckets sessions.</summary>
public readonly record struct AggregateMonth(int Year, int Month) : IComparable<AggregateMonth>
{
    public static AggregateMonth Of(Instant instant)
    {
        var utc = instant.InUtc();
        return new AggregateMonth(utc.Year, utc.Month);
    }

    public static AggregateMonth Of(DateTime utc) => new(utc.Year, utc.Month);

    public AggregateMonth Next() => Month == 12 ? new AggregateMonth(Year + 1, 1) : new AggregateMonth(Year, Month + 1);

    public AggregateMonth Previous() => Month == 1 ? new AggregateMonth(Year - 1, 12) : new AggregateMonth(Year, Month - 1);

    /// <summary>
    /// The month's bounds in the text PlayerSessions stores timestamps as, so a range on
    /// LastSeenTime compares correctly as strings and can use its index.
    /// </summary>
    public (string Start, string End) Bounds() =>
        (Format(new DateTime(Year, Month, 1, 0, 0, 0, DateTimeKind.Utc)),
         Format(new DateTime(Year, Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1)));

    public int CompareTo(AggregateMonth other) => (Year * 12 + Month).CompareTo(other.Year * 12 + other.Month);

    public static bool operator <(AggregateMonth left, AggregateMonth right) => left.CompareTo(right) < 0;
    public static bool operator >(AggregateMonth left, AggregateMonth right) => left.CompareTo(right) > 0;
    public static bool operator <=(AggregateMonth left, AggregateMonth right) => left.CompareTo(right) <= 0;
    public static bool operator >=(AggregateMonth left, AggregateMonth right) => left.CompareTo(right) >= 0;

    public override string ToString() => $"{Year:D4}-{Month:D2}";

    public static bool TryParse(string? value, out AggregateMonth month)
    {
        month = default;
        if (!DateTime.TryParseExact(value, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            return false;
        month = new AggregateMonth(parsed.Year, parsed.Month);
        return true;
    }

    private static string Format(DateTime utc) => utc.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
