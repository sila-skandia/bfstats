using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.tests.Recordings;

/// <summary>A clock the tests move by hand.</summary>
internal sealed class TestClock(Instant now) : IClock
{
    public Instant Now { get; set; } = now;

    public Instant GetCurrentInstant() => Now;
}

/// <summary>
/// An in-memory database with users (three with a linked player name, one of them an admin,
/// and one with none), a throwaway recordings directory, and the services over them.
/// </summary>
internal sealed class RecordingFixture : IDisposable
{
    public static readonly Instant Start = Instant.FromUtc(2026, 9, 28, 10, 0);

    private readonly SqliteConnection connection;

    public RecordingFixture(Func<RecordingsOptions, RecordingsOptions>? configure = null)
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        Db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        Db.Database.EnsureCreated();

        Directory = Path.Combine(Path.GetTempPath(), $"bfstats-recordings-test-{Guid.NewGuid():N}");
        var options = new RecordingsOptions { Path = Directory, MinFreeBytes = 0, MinFreeFraction = 0 };
        Options = Microsoft.Extensions.Options.Options.Create(configure?.Invoke(options) ?? options);
        Storage = new RecordingStorage(Options);
        Clock = new TestClock(Start);

        Uploader = AddUser("uploader@example.com", "skandia");
        Other = AddUser("other@example.com", "Rut");
        Admin = AddUser("admin@example.com", "Boss");
        Unlinked = AddUser("unlinked@example.com", null);
        Db.SaveChanges();

        Rounds = new RecordingRoundService(Db, Storage, Clock, Options, NullLogger<RecordingRoundService>.Instance);
        Service = new RecordingService(Db, Storage, Clock, Options, NullLogger<RecordingService>.Instance, Rounds);
        Uploads = new RecordingUploadService(
            Db, Storage, Service, Clock, Options, NullLogger<RecordingUploadService>.Instance, Rounds);
    }

    public PlayerTrackerDbContext Db { get; }
    public string Directory { get; }
    public IOptions<RecordingsOptions> Options { get; }
    public RecordingStorage Storage { get; }
    public TestClock Clock { get; }
    public RecordingService Service { get; }
    public RecordingUploadService Uploads { get; }
    public RecordingRoundService Rounds { get; }
    public User Uploader { get; }
    public User Other { get; }
    public User Admin { get; }

    /// <summary>Signed in, with no player name linked to the account.</summary>
    public User Unlinked { get; }

    public RecordingActor AsUploader => new(Uploader.Id, false);
    public RecordingActor AsOther => new(Other.Id, false);
    public RecordingActor AsAdmin => new(Admin.Id, true);
    public RecordingActor AsUnlinked => new(Unlinked.Id, false);

    private User AddUser(string email, string? playerName)
    {
        var user = new User { Email = email, CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        Db.Users.Add(user);
        Db.SaveChanges();
        if (playerName is not null)
        {
            Db.UserPlayerNames.Add(new UserPlayerName { UserId = user.Id, PlayerName = playerName, CreatedAt = DateTime.UtcNow });
        }
        return user;
    }

    /// <summary>The details the share dialog sends: a title and whom it goes up as, nothing
    /// else read of the file.</summary>
    public static RecordingUploadMeta Meta(string title = "Midway at dawn", string? authorName = null, string? recordedBy = null) =>
        new(title, authorName, null, null, null, null, recordedBy, null, null, null);

    /// <summary>Shares <paramref name="recording"/> as the uploader would from the feed:
    /// gzipped, with its details.</summary>
    public async Task<RecordingDetailDto> UploadAsync(
        string recording, RecordingUploadMeta? meta = null, RecordingActor? actor = null, bool gzip = true, string? serverLog = null)
    {
        using var content = Multipart(recording, meta ?? new RecordingUploadMeta(
            "Midway at dawn", "skandia", null, null, null, null, null, null, null, null), gzip, serverLog);
        await using var body = await content.ReadAsStreamAsync();
        return await Uploads.UploadAsync(
            content.Headers.ContentType!.ToString(), body, body.Length, actor ?? AsUploader, CancellationToken.None);
    }

    /// <summary>Shares a recording whose bytes are given as they go over the wire.</summary>
    public async Task<RecordingDetailDto> UploadBytesAsync(byte[] recording, RecordingUploadMeta meta, RecordingActor? actor = null)
    {
        using var content = new MultipartFormDataContent();
        content.Add(new StringContent(JsonSerializer.Serialize(meta), Encoding.UTF8, "application/json"), "meta");
        content.Add(new ByteArrayContent(recording), "recording", "replay.ndjson.gz");
        await using var body = await content.ReadAsStreamAsync();
        return await Uploads.UploadAsync(
            content.Headers.ContentType!.ToString(), body, body.Length, actor ?? AsUploader, CancellationToken.None);
    }

    public static MultipartFormDataContent Multipart(string recording, RecordingUploadMeta meta, bool gzip, string? serverLog = null)
    {
        var content = new MultipartFormDataContent();
        var metaPart = new StringContent(JsonSerializer.Serialize(meta), Encoding.UTF8, "application/json");
        content.Add(metaPart, "meta");
        var file = new ByteArrayContent(gzip ? Gzip(recording) : Encoding.UTF8.GetBytes(recording));
        file.Headers.ContentType = new MediaTypeHeaderValue(gzip ? "application/gzip" : "application/x-ndjson");
        content.Add(file, "recording", "replay_20260927-203459.ndjson.gz");
        if (serverLog is not null)
        {
            content.Add(new ByteArrayContent(Gzip(serverLog)), "serverlog", "ev_1.xml.gz");
        }
        return content;
    }

    public static byte[] Gzip(string text) => Gzip(Encoding.UTF8.GetBytes(text), CompressionLevel.Fastest);

    /// <summary>A file as the API keeps it: what it read, gzipped by it.</summary>
    public static byte[] Kept(string text) => Gzip(Encoding.UTF8.GetBytes(text), CompressionLevel.Optimal);

    public static byte[] Gzip(byte[] bytes, CompressionLevel level)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, level, leaveOpen: true))
        {
            gzip.Write(bytes);
        }
        return output.ToArray();
    }

    /// <summary>A dedicated server's event log as the game writes it, cut off where a round
    /// still running leaves it: no closing tags.</summary>
    public static string EventLog(string events = "") => string.Join('\n',
        """<?xml version="1.0" encoding="iso-8859-1"?>""",
        """<bf:log version="1.1" xmlns:bf="http://www.dice.se/xmlns/bf/1.1">""",
        """<bf:round timestamp="2.96057">""",
        """<bf:server>""",
        """  <bf:setting name="server name">bfstats-lab</bf:setting>""",
        """  <bf:setting name="map">midway</bf:setting>""",
        """</bf:server>""",
        """<bf:event name="createPlayer" timestamp="12.4">""",
        """    <bf:param type="int" name="player_id">0</bf:param>""",
        """    <bf:param type="string" name="name">skandia</bf:param>""",
        """</bf:event>""",
        events,
        """<bf:event name="destroyPlayer" timestamp="295.558">""",
        """    <bf:param type="int" name="player_id">0</bf:param>""",
        """    <bf:param type="string" name="player_location">(unknown)</bf:param>""",
        """</bf:event>""") + "\n";

    /// <summary>A Midway round as bf42plus writes it, cut down: the header, the round's
    /// description, a roster naming the recording player, a later join, and the end.</summary>
    public static string Midway(string salt = "") => string.Join('\n',
        """{"k":"h","v":5,"plus":"2.0","start":"2026-09-27T20:34:59","hz":10}""",
        """{"k":"e","t":0.000,"e":"serverInfo","mapId":"BF1942","mod":"bf1942","gameId":"BF1942","ago":41.322}""",
        """{"k":"e","t":0.000,"e":"serverName","name":"MoonGamers.com | Est. 2004","ago":41.322}""",
        """{"k":"e","t":0.000,"e":"setLevel","level":"bf1942/levels/midway/","mode":"conquest.con","ago":40.848}""",
        """{"k":"roster","t":0.000,"p":[[0,2,0,"Rut",0],[8,2,0,"skandia",1],[3,1,1,"Bot",0]]}""",
        """{"k":"o","t":0.000,"id":18,"gid":3906,"tmpl":"MultiPlayerFreeCamera","tid":1571,"team":0}""",
        """{"k":"e","t":184.474,"e":"createPlayer","pid":9,"name":"Lapu","team":1,"ai":0,"netId":19}""",
        """{"k":"chat","t":200.5,"pid":9,"text":"gg""" + salt + "\"}",
        """{"k":"end","t":883.029}""") + "\n";

    public void Dispose()
    {
        Db.Dispose();
        connection.Dispose();
        try
        {
            System.IO.Directory.Delete(Directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
