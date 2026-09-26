namespace api.ServiceRecord.Models;

/// <summary>
/// Which sessions a record covers: the whole career once PlayerTeamMapStats is complete,
/// until then the player's most recent, up to <see cref="ServiceRecordStore.SessionWindow"/>.
/// </summary>
/// <param name="Sessions">Sessions counted.</param>
/// <param name="Capped">True when older sessions were left out.</param>
/// <param name="Since">When the oldest counted session started, UTC; null with no sessions.</param>
public record ServiceRecordWindow(int Sessions, bool Capped, DateTime? Since);
