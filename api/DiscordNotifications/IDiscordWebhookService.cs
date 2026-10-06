using api.DiscordNotifications.Models;

namespace api.DiscordNotifications;

public interface IDiscordWebhookService
{
    /// <summary>
    /// Sends a Discord notification for a low-quality AI response.
    /// </summary>
    Task SendAIQualityAlertAsync(AIQualityAlert alert);
}
