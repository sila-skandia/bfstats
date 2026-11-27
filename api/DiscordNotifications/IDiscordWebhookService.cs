using api.DiscordNotifications.Models;

namespace api.DiscordNotifications;

public interface IDiscordWebhookService
{
    /// <summary>
    /// Sends a Discord notification for a low-quality AI response.
    /// </summary>
    Task SendAIQualityAlertAsync(AIQualityAlert alert);

    /// <summary>
    /// Tells the owner a password account asked for a reset it cannot get by email,
    /// so they can regenerate one from the admin Access tab (features/password-reset).
    /// </summary>
    Task SendPasswordResetHelpAsync(PasswordResetHelpRequest request);
}
