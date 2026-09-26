namespace api.ServiceRecord.Models;

/// <summary>
/// Totals for one side, whether or not the map's dossier could name the army.
/// </summary>
/// <param name="Side">"axis" or "allied".</param>
public record ServiceRecordSide(
    string Side,
    double Minutes,
    int Rounds,
    int Kills,
    int Deaths,
    int Wins,
    int Losses);
