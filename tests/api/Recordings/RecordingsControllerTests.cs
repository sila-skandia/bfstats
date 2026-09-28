using api.Recordings;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace api.tests.Recordings;

public sealed class RecordingsControllerTests : IDisposable
{
    private const string Slug = "abcdefghjk";

    private readonly string directory = Path.Combine(Path.GetTempPath(), $"bfstats-recordings-controller-{Guid.NewGuid():N}");
    private readonly RecordingStorage storage;
    private readonly RecordingsController controller;

    public RecordingsControllerTests()
    {
        storage = new RecordingStorage(Options.Create(new RecordingsOptions { Path = directory }));
        File.WriteAllBytes(storage.RecordingPath(Slug), RecordingFixture.Kept(RecordingFixture.Midway()));
        File.WriteAllBytes(storage.ServerLogPath(Slug), RecordingFixture.Kept(RecordingFixture.EventLog()));
        File.WriteAllBytes(storage.ThumbnailPath(Slug), [0xFF, 0xD8, 0xFF, 0xD9]);
        controller = new RecordingsController(
            Substitute.For<IRecordingService>(),
            Substitute.For<IRecordingUploadService>(),
            storage,
            Substitute.For<IRecordingViewCounter>(),
            Substitute.For<IConfiguration>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    /// <summary>A shared file is someone's upload served from bfstats.io: a browser sent
    /// straight to one must neither guess it is a page nor, as an XML page, run what is in it.</summary>
    [Theory]
    [InlineData("ndjson", "application/x-ndjson")]
    [InlineData("xml", "text/xml")]
    [InlineData("jpg", "image/jpeg")]
    public void SharedFiles_AreServedInert(string kind, string contentType)
    {
        var result = kind switch
        {
            "ndjson" => controller.RecordingFile(Slug),
            "xml" => controller.ServerLogFile(Slug),
            _ => controller.Thumbnail(Slug),
        };

        var file = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal(contentType, file.ContentType);
        var headers = controller.Response.Headers;
        Assert.Equal("nosniff", headers.XContentTypeOptions.ToString());
        Assert.Equal("default-src 'none'; sandbox", headers.ContentSecurityPolicy.ToString());
    }
}
