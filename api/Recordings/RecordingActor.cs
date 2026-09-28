namespace api.Recordings;

/// <summary>Who is asking: a signed-in user, and whether they are an admin.</summary>
public sealed record RecordingActor(int UserId, bool IsAdmin);
