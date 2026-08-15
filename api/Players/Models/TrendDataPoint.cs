namespace api.Players.Models;

public class TrendDataPoint
{
    public DateTime Timestamp { get; set; }
    public double Value { get; set; }

    /// <summary>Rounds (player sessions) that fell in this bucket.</summary>
    public int SessionCount { get; set; }
}
