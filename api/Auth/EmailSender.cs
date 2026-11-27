using api.Auth.Models;
using Microsoft.Extensions.Logging;

namespace api.Auth;

/// <summary>
/// Outbound email seam. Production sends through Cloudflare Email Service
/// (<see cref="CloudflareEmailSender"/>); without its account id and token the
/// API falls back to <see cref="NoOpEmailSender"/>, which logs and drops, so a
/// dev machine never needs credentials.
/// </summary>
public interface IEmailSender
{
    /// <summary>Sends one message; throws <see cref="EmailDeliveryException"/> when the provider refuses it.</summary>
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

public class EmailDeliveryException : Exception
{
    public EmailDeliveryException() { }
    public EmailDeliveryException(string message) : base(message) { }
    public EmailDeliveryException(string message, Exception innerException) : base(message, innerException) { }
}

public class NoOpEmailSender(ILogger<NoOpEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        // Never the address or the body: the body carries a live reset link.
        logger.LogInformation("Email delivery not configured (CloudflareEmail:AccountId/ApiToken); dropped message '{Subject}'", message.Subject);
        return Task.CompletedTask;
    }
}
