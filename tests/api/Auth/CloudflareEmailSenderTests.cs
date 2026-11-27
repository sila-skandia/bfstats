using System.Net;
using System.Text.Json;
using api.Auth;
using api.Auth.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace api.tests.Auth;

/// <summary>The request Cloudflare Email Service's REST send endpoint gets, and how its refusals surface.</summary>
public class CloudflareEmailSenderTests
{
    private sealed class Recorder(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            RequestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        }
    }

    private static CloudflareEmailSender Sender(Recorder recorder)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient(CloudflareEmailSender.HttpClientName).Returns(new HttpClient(recorder));
        return new CloudflareEmailSender(
            factory,
            Options.Create(new CloudflareEmailOptions { AccountId = "acct123", ApiToken = "tok", From = "noreply@bfstats.io" }),
            NullLogger<CloudflareEmailSender>.Instance);
    }

    private static readonly EmailMessage Message = new("player@example.com", "Subject", "<p>hi</p>", "hi");

    [Fact]
    public async Task Posts_TheMessage_ToTheAccountsSendEndpoint()
    {
        var recorder = new Recorder(HttpStatusCode.OK,
            """{"success":true,"errors":[],"messages":[],"result":{"message_id":"<x@bfstats.io>","delivered":["player@example.com"],"permanent_bounces":[],"queued":[],"suppressed_recipients":[]}}""");

        await Sender(recorder).SendAsync(Message);

        Assert.Equal(HttpMethod.Post, recorder.Request!.Method);
        Assert.Equal("https://api.cloudflare.com/client/v4/accounts/acct123/email/sending/send", recorder.Request.RequestUri!.ToString());
        Assert.Equal("Bearer tok", recorder.Request.Headers.Authorization!.ToString());
        using var json = JsonDocument.Parse(recorder.RequestBody!);
        Assert.Equal("player@example.com", json.RootElement.GetProperty("to").GetString());
        Assert.Equal("noreply@bfstats.io", json.RootElement.GetProperty("from").GetString());
        Assert.Equal("Subject", json.RootElement.GetProperty("subject").GetString());
        Assert.Equal("<p>hi</p>", json.RootElement.GetProperty("html").GetString());
        Assert.Equal("hi", json.RootElement.GetProperty("text").GetString());
    }

    [Fact]
    public async Task ARefusal_Throws()
    {
        var recorder = new Recorder(HttpStatusCode.Forbidden,
            """{"success":false,"errors":[{"code":10102,"message":"email.sending.error.forbidden"}],"messages":[],"result":null}""");

        var ex = await Assert.ThrowsAsync<EmailDeliveryException>(() => Sender(recorder).SendAsync(Message));
        Assert.Contains("10102", ex.Message);
    }

    [Fact]
    public async Task ANonJsonError_Throws()
    {
        var recorder = new Recorder(HttpStatusCode.BadGateway, "<html>bad gateway</html>");

        await Assert.ThrowsAsync<EmailDeliveryException>(() => Sender(recorder).SendAsync(Message));
    }
}
