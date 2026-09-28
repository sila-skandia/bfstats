using Microsoft.AspNetCore.Http;

namespace api.Recordings;

/// <summary>A shared file that is not what it says it is, or does not fit. The message is the
/// uploader's to read, so it says what to do.</summary>
public sealed class RecordingRejectedException : Exception
{
    public RecordingRejectedException()
    {
    }

    public RecordingRejectedException(string message)
        : base(message)
    {
    }

    public RecordingRejectedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    public RecordingRejectedException(string message, int statusCode, string? existingSlug = null)
        : base(message)
    {
        StatusCode = statusCode;
        ExistingSlug = existingSlug;
    }

    /// <summary>What the request answers: 400 for a file that is not a recording, 403 for
    /// someone else's, 409 for a round already shared, 413 for one too big, 507 when the
    /// disk has no room for it.</summary>
    public int StatusCode { get; } = StatusCodes.Status400BadRequest;

    /// <summary>For a 409: the recording this round is already shared as.</summary>
    public string? ExistingSlug { get; }
}
