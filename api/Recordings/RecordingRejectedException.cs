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

    /// <summary>An admin's link the recordings do not bear out, refused until it is
    /// confirmed: a 409 with what their files say.</summary>
    public RecordingRejectedException(Models.RecordingRoundEvidenceDto evidence)
        : base(evidence.Summary)
    {
        StatusCode = StatusCodes.Status409Conflict;
        Evidence = evidence;
    }

    /// <summary>What the request answers: 400 for a file that is not a recording, 403 for
    /// someone else's, 409 for a round already shared or a link to confirm, 413 for one too
    /// big, 507 when the disk has no room for it.</summary>
    public int StatusCode { get; } = StatusCodes.Status400BadRequest;

    /// <summary>For a 409: the recording this round is already shared as.</summary>
    public string? ExistingSlug { get; }

    /// <summary>For a 409 on an admin's link: what the two recordings' files say.</summary>
    public Models.RecordingRoundEvidenceDto? Evidence { get; }
}
