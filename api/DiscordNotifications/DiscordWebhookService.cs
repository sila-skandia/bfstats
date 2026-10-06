using System.Net.Http.Json;
using System.Text;
using api.DiscordNotifications.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.DiscordNotifications;

public class DiscordWebhookService(
    IHttpClientFactory httpClientFactory,
    IOptions<DiscordAIQualityOptions> aiQualityOptions,
    ILogger<DiscordWebhookService> logger) : IDiscordWebhookService
{
    private readonly DiscordAIQualityOptions _aiQualityOptions = aiQualityOptions.Value;

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
