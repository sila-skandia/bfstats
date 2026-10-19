using System.Diagnostics;
using notifications.Telemetry;

namespace notifications.tests.Telemetry;

public class TransientApiHttpSpanProcessorTests : IDisposable
{
    private readonly ActivitySource _source = new("TransientApiHttpSpanProcessorTests");
    private readonly ActivityListener _listener;

    public TransientApiHttpSpanProcessorTests()
    {
        _listener = new ActivityListener
        {
            ShouldListenTo = static source => source.Name == "TransientApiHttpSpanProcessorTests",
            Sample = static (ref ActivityCreationOptions<ActivityContext> _) =>
                ActivitySamplingResult.AllDataAndRecorded
        };
        ActivitySource.AddActivityListener(_listener);
    }

    public void Dispose()
    {
        _listener.Dispose();
        _source.Dispose();
    }

    [Fact]
    public void ShouldDrop_ConnectionErrorToApiHost()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Error);
        activity.SetTag("error.type", "connection_error");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);

        Assert.True(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Theory]
    [InlineData("name_resolution_error")]
    [InlineData("secure_connection_error")]
    public void ShouldDrop_OtherTransientConnectErrorsToApiHost(string errorType)
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Error);
        activity.SetTag("error.type", errorType);
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);

        Assert.True(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Fact]
    public void ShouldNotDrop_ConnectionErrorToOtherHost()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Error);
        activity.SetTag("error.type", "connection_error");
        activity.SetTag("server.address", "api.bflist.io");

        Assert.False(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Fact]
    public void ShouldNotDrop_HttpErrorFromApiHost()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Error);
        activity.SetTag("error.type", "500");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);

        Assert.False(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Fact]
    public void ShouldDrop_UnsetStatus_AfterEnrichWithException()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Unset);
        activity.SetTag("error.type", "connection_error");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);

        Assert.True(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Fact]
    public void ShouldNotDrop_SuccessfulClientSpanToApiHost()
    {
        using var activity = StartClient("GET");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);
        activity.SetTag("http.response.status_code", 200);

        Assert.False(TransientApiHttpSpanProcessor.ShouldDrop(activity));
    }

    [Fact]
    public void OnEnd_ClearsRecordedFlag_ForDroppedSpans()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Unset);
        activity.SetTag("error.type", "connection_error");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);
        Assert.True(activity.Recorded);

        using var processor = new TransientApiHttpSpanProcessor();
        processor.OnEnd(activity);

        Assert.Equal(ActivityStatusCode.Unset, activity.Status);
        Assert.False(activity.Recorded);
    }

    [Fact]
    public void OnEnd_LeavesOtherErrorSpansRecorded()
    {
        using var activity = StartClient("GET");
        activity.SetStatus(ActivityStatusCode.Error);
        activity.SetTag("error.type", "500");
        activity.SetTag("server.address", TransientApiHttpSpanProcessor.ApiHost);

        using var processor = new TransientApiHttpSpanProcessor();
        processor.OnEnd(activity);

        Assert.Equal(ActivityStatusCode.Error, activity.Status);
        Assert.True(activity.Recorded);
    }

    private Activity StartClient(string name)
    {
        var activity = _source.StartActivity(name, ActivityKind.Client);
        Assert.NotNull(activity);
        return activity;
    }
}
