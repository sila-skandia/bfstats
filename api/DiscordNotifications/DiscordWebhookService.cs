using System.Net.Http.Json;
using System.Text;
using api.DiscordNotifications.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.DiscordNotifications;

public class DiscordWebhookService(
    IHttpClientFactory httpClientFactory,
    IOptions<DiscordAIQualityOptions> aiQualityOptions,
    IOptions<DiscordPasswordResetOptions> passwordResetOptions,
    ILogger<DiscordWebhookService> logger) : IDiscordWebhookService
{
    private readonly DiscordAIQualityOptions _aiQualityOptions = aiQualityOptions.Value;
    private readonly DiscordPasswordResetOptions _passwordResetOptions = passwordResetOptions.Value;

    public async Task SendPasswordResetHelpAsync(PasswordResetHelpRequest request)
    {
        if (string.IsNullOrEmpty(_passwordResetOptions.WebhookUrl))
        {
            logger.LogDebug("Discord password reset webhook URL not configured, skipping notice");
            return;
        }

        var why = request.Reason switch
        {
            PasswordResetHelpReason.NoEmailOnAccount => "The account has no email, so no reset link could be sent.",
            _ => "The email typed is not the one on the account, so no reset link was sent.",
        };
        var embed = new
        {
            title = "Password reset needs a hand",
            description =
                $"**Account:** {Escape(request.Username)} (user id {request.UserId})\n{why}\n\n" +
                $"Find them on Discord, then regenerate a password from Admin, Access: {_passwordResetOptions.AdminUrl}",
            color = 0x847d4c,
            timestamp = DateTime.UtcNow.ToString("o"),
        };

        try
        {
            var client = httpClientFactory.CreateClient("DiscordWebhook");
            // No pings: a username is user-chosen text.
            var payload = new { embeds = new[] { embed }, allowed_mentions = new { parse = Array.Empty<string>() } };
            var response = await client.PostAsJsonAsync(_passwordResetOptions.WebhookUrl, payload);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning("Discord password reset webhook returned {StatusCode}", response.StatusCode);
            else
                logger.LogInformation("Sent password reset help notice for user {UserId}", request.UserId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send Discord password reset notice");
        }
    }

    /// <summary>Usernames are [A-Za-z0-9_.-]; escape the two that are Markdown.</summary>
    private static string Escape(string text) => text.Replace("_", "\\_").Replace("*", "\\*");

    public async Task SendAIQualityAlertAsync(AIQualityAlert alert)
    {
        if (string.IsNullOrEmpty(_aiQualityOptions.WebhookUrl))
        {
            logger.LogDebug("Discord AI quality webhook URL not configured, skipping alert");
            return;
        }

        try
        {
            var embed = BuildAIQualityEmbed(alert);
            var payload = new { embeds = new[] { embed } };

            var client = httpClientFactory.CreateClient("DiscordWebhook");
            var response = await client.PostAsJsonAsync(_aiQualityOptions.WebhookUrl, payload);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                logger.LogWarning(
                    "Discord AI quality webhook returned {StatusCode}: {Body}",
                    response.StatusCode, body);
            }
            else
            {
                logger.LogInformation(
                    "Sent AI quality alert: Confidence={Confidence}, SufficientMethods={Sufficient}",
                    alert.Confidence, alert.SufficientKernelMethods);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send Discord AI quality alert");
        }
    }

    private object BuildAIQualityEmbed(AIQualityAlert alert)
    {
        var description = new StringBuilder();

        // Confidence indicator
        var confidenceEmoji = alert.Confidence switch
        {
            "low" => "🔴",
            "medium" => "🟡",
            _ => "🟢"
        };
        description.AppendLine($"**Confidence:** {confidenceEmoji} {alert.Confidence}");
        description.AppendLine($"**Sufficient Methods:** {(alert.SufficientKernelMethods ? "✅ Yes" : "❌ No")}");
        description.AppendLine();

        if (alert.MissingContext.Length > 0)
        {
            description.AppendLine("**Missing Context:**");
            foreach (var context in alert.MissingContext)
            {
                description.AppendLine($"• {context}");
            }
            description.AppendLine();
        }

        if (alert.SuggestedKernelMethods.Length > 0)
        {
            description.AppendLine("**Suggested Kernel Methods:**");
            foreach (var method in alert.SuggestedKernelMethods)
            {
                description.AppendLine($"• `{method}`");
            }
            description.AppendLine();
        }

        // Truncate user message if too long
        var userMessage = alert.UserMessage.Length > 500
            ? alert.UserMessage[..500] + "..."
            : alert.UserMessage;
        description.AppendLine("**User Message:**");
        description.AppendLine($"```{userMessage}```");

        // Color based on confidence (red for low, yellow for medium)
        var color = alert.Confidence == "low" ? 15158332 : 16776960; // Red or Yellow

        return new
        {
            title = "🤖 AI Quality Alert",
            description = description.ToString(),
            color,
            timestamp = DateTime.UtcNow.ToString("o")
        };
    }
}
