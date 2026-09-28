namespace api.Recordings.Models;

/// <summary>How much of the shared space the recordings take.</summary>
public record RecordingStorageDto(long UsedBytes, long QuotaBytes);
