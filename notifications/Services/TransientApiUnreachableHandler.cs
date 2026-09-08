using System.Net;

namespace notifications.Services;

/// <summary>
/// The API is a single replica with Recreate, so cluster DNS refuses connections
/// for tens of seconds during a rollout. Favourite-server lookups are best-effort;
/// converting the transport failure into 503 keeps OpenTelemetry from recording
/// an ERROR span that pages Seq Exceptions.
/// </summary>
public sealed class TransientApiUnreachableHandler : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await base.SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ApiConnectionFailureClassifier.IsTransient(ex))
        {
            return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            {
                RequestMessage = request,
                ReasonPhrase = "API unreachable"
            };
        }
    }
}
