namespace api.ServiceRecord.Models;

/// <summary>
/// A player's time attributed to the armies they fought for. bflist only reports "Axis"
/// and "Allied"; the map's dossier turns that into a nationality. See
/// features/service-record/README.md for the contract.
/// </summary>
/// <param name="PlayerName">The player's stored name, undecoded.</param>
/// <param name="TotalMinutes">Every bf1942 session, attributed or not.</param>
/// <param name="AttributedMinutes">The part of <paramref name="TotalMinutes"/> credited to an army.</param>
/// <param name="Sides">Always both sides, Axis first.</param>
/// <param name="Armies">Most minutes first.</param>
/// <param name="Unattributed">Sessions no army could be named for.</param>
/// <param name="Window">Which of the player's sessions the record covers.</param>
public record PlayerServiceRecord(
    string PlayerName,
    double TotalMinutes,
    double AttributedMinutes,
    IReadOnlyList<ServiceRecordSide> Sides,
    IReadOnlyList<ServiceRecordArmy> Armies,
    ServiceRecordUnattributed Unattributed,
    ServiceRecordWindow Window);
