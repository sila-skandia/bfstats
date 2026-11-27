using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using api.Auth.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Auth;

/// <summary>
/// Sends through Cloudflare Email Service's REST API:
/// <c>POST /client/v4/accounts/{account}/email/sending/send</c>.
/// </summary>
public class CloudflareEmailSender(
    IHttpClientFactory httpClientFactory,
    IOptions<CloudflareEmailOptions> options,
    ILogger<CloudflareEmailSender> logger) : IEmailSender
{
    public const string HttpClientName = "CloudflareEmail";

    private readonly CloudflareEmailOptions _options = options.Value;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://api.cloudflare.com/client/v4/accounts/{Uri.EscapeDataString(_options.AccountId!)}/email/sending/send")
        {
            Content = JsonContent.Create(new SendBody(message.To, _options.From, message.Subject, message.Html, message.Text)),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiToken);

        using var response = await client.SendAsync(request, cancellationToken);
        SendResponse body;
        try
        {
            body = await response.Content.ReadFromJsonAsync<SendResponse>(cancellationToken) ?? new SendResponse(false, null, null);
        }
        catch (System.Text.Json.JsonException)
        {
            body = new SendResponse(false, null, null); // a proxy's HTML error page, say
        }

        if (!response.IsSuccessStatusCode || !body.Success)
        {
            // Codes and messages only: Cloudflare's errors never echo the recipient.
            var errors = string.Join("; ", (body.Errors ?? []).Select(e => $"{e.Code} {e.Message}"));
            logger.LogWarning("Cloudflare Email refused '{Subject}': HTTP {Status} {Errors}", message.Subject, (int)response.StatusCode, errors);
            throw new EmailDeliveryException($"Cloudflare Email returned {(int)response.StatusCode}: {errors}");
        }

        var result = body.Result;
        if (result is not null && (result.PermanentBounces is { Count: > 0 } || result.SuppressedRecipients is { Count: > 0 }))
        {
            logger.LogWarning("Cloudflare Email accepted '{Subject}' but the recipient bounced or is suppressed", message.Subject);
            return;
        }
        logger.LogInformation("Cloudflare Email sent '{Subject}' ({MessageId})", message.Subject, result?.MessageId);
    }

    private sealed record SendBody(
        [property: JsonPropertyName("to")] string To,
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("html")] string Html,
        [property: JsonPropertyName("text")] string Text);

    private sealed record SendResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("errors")] List<SendError>? Errors,
        [property: JsonPropertyName("result")] SendResult? Result);

    private sealed record SendError(
        [property: JsonPropertyName("code")] int Code,
        [property: JsonPropertyName("message")] string Message);

    private sealed record SendResult(
        [property: JsonPropertyName("message_id")] string? MessageId,
        [property: JsonPropertyName("permanent_bounces")] List<string>? PermanentBounces,
        [property: JsonPropertyName("suppressed_recipients")] List<string>? SuppressedRecipients);
}
