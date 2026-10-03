using Microsoft.Extensions.Logging;

namespace api.Auth;

/// <summary>
/// Outbound email seam. There is no SMTP relay on the deployment node today,
/// so the default implementation logs and drops: the forgotten-password
/// endpoint already answers with a uniform 200 and no delivery promise,
/// which keeps the UX honest. When an SMTP relay lands, replace this class —
/// everything else calls the interface.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string toAddress, string subject, string body, CancellationToken cancellationToken = default);
}

public class NoOpEmailSender(ILogger<NoOpEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string toAddress, string subject, string body, CancellationToken cancellationToken = default)
    {
        // No address contents here — the caller logs ids, we log that a
        // message was dropped, which is all an operator can act on until a
        // relay exists.
        logger.LogInformation("Email delivery unavailable (no SMTP configured); dropped message '{Subject}'", subject);
        return Task.CompletedTask;
    }
}