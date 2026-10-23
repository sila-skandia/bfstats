using System.Diagnostics;
using OpenTelemetry;

namespace notifications.Telemetry;

/// <summary>
/// Recreate of the single API replica refuses connections for tens of seconds.
/// HttpClient instrumentation still exports that as an ERROR span with the
/// exception attached, which pages Seq (@Exception is not null) even after
/// TransientApiUnreachableHandler returns 503 and EnrichWithException unsets
/// status. Drop the client span so only the parent GetUsers* span remains.
/// </summary>
public sealed class TransientApiHttpSpanProcessor : BaseProcessor<Activity>
{
    public const string ApiHost = "bf42-stats-service.bf42-stats";

    public override void OnEnd(Activity activity)
    {
        if (!ShouldDrop(activity))
        {
            return;
        }

        activity.SetStatus(ActivityStatusCode.Unset);
        activity.ActivityTraceFlags &= ~ActivityTraceFlags.Recorded;
    }

    public static bool ShouldDrop(Activity activity)
    {
        if (activity.Kind != ActivityKind.Client)
        {
            return false;
        }

        var errorType = activity.GetTagItem("error.type")?.ToString();
        if (errorType is not ("connection_error" or "name_resolution_error" or "secure_connection_error"))
        {
            return false;
        }

        var address = activity.GetTagItem("server.address")?.ToString();
        return string.Equals(address, ApiHost, StringComparison.OrdinalIgnoreCase);
    }
}
