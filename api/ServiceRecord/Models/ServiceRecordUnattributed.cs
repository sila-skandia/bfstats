namespace api.ServiceRecord.Models;

/// <summary>
/// Sessions credited to no army: a numeric or empty team label, or a map with no dossier.
/// </summary>
public record ServiceRecordUnattributed(double Minutes, int Rounds);
