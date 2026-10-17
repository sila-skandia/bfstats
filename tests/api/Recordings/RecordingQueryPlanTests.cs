using System.Data.Common;
using api.PlayerTracking;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Recordings;

/// <summary>
/// The lists on bfstats.io's server and player pages find their recordings through indexes
/// (features/replay-on-stats-pages): every statement a narrowed list sends is planned, and none
/// may read a whole table. A page's cost then follows how many recordings it shows, not how
/// many have been shared. The whole feed and its filter choices read the cards and counts the
/// triggers keep (features/replay-feed, "Scale"), and so do the triggers themselves.
/// </summary>
public sealed class RecordingQueryPlanTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    /// <summary>Plans each SELECT on its way to the database, with its own parameters.</summary>
    private sealed class PlanRecorder : DbCommandInterceptor
    {
        public List<(string Sql, List<string> Plan)> Statements { get; } = [];

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }

        private void Record(DbCommand command)
        {
            if (!command.CommandText.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)) return;
            using var explain = command.Connection!.CreateCommand();
            // EF's own statement, planned as it is about to run: no input reaches it.
#pragma warning disable CA2100
            explain.CommandText = "EXPLAIN QUERY PLAN " + command.CommandText;
#pragma warning restore CA2100
            foreach (DbParameter p in command.Parameters)
            {
                var copy = explain.CreateParameter();
                copy.ParameterName = p.ParameterName;
                copy.Value = p.Value;
                explain.Parameters.Add(copy);
            }
            var plan = new List<string>();
            using (var reader = explain.ExecuteReader())
            {
                while (reader.Read()) plan.Add(reader.GetString(3));
            }
            Statements.Add((command.CommandText, plan));
        }
    }

    private async Task<List<(string Sql, List<string> Plan)>> PlansOf(Func<RecordingService, Task> ask)
    {
        var recorder = new PlanRecorder();
        await using var db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(fixture.Connection).AddInterceptors(recorder).Options);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        // The storage total is a sum over everything, kept a minute; a page that comes while it
        // is kept reads nothing for it.
        cache.Set(RecordingService.StorageUsedKey, 0L);
        var rounds = new RecordingRoundService(db, fixture.Storage, fixture.Clock, fixture.Options, NullLogger<RecordingRoundService>.Instance);
        var service = new RecordingService(db, fixture.Storage, fixture.Clock, fixture.Options, NullLogger<RecordingService>.Instance, rounds, cache);
        await ask(service);
        return recorder.Statements;
    }

    private Task<List<(string Sql, List<string> Plan)>> PlansOf(RecordingFilter filter, string? sort = null) => PlansOf(async service =>
    {
        var page = await service.ListAsync(sort, 1, 6, filter, null, default);
        Assert.NotEmpty(page.Items);
    });

    private static void AssertNoTableScan(List<(string Sql, List<string> Plan)> statements)
    {
        Assert.NotEmpty(statements);
        foreach (var (sql, plan) in statements)
        {
            // A scan of a subquery's own rows (a co-routine or a materialised result) reads only
            // what the indexed lookups inside it found.
            var derived = plan
                .Where(step => step.StartsWith("CO-ROUTINE ", StringComparison.Ordinal) || step.StartsWith("MATERIALIZE ", StringComparison.Ordinal))
                .Select(step => step[(step.IndexOf(' ') + 1)..].Trim())
                .ToHashSet(StringComparer.Ordinal);
            var scans = plan
                .Where(step => step.StartsWith("SCAN ", StringComparison.Ordinal) && !derived.Contains(step[5..].Trim()))
                .ToList();
            Assert.True(scans.Count == 0, $"Reads a whole table:\n{string.Join('\n', scans)}\nin:\n{sql}\nplanned:\n{string.Join('\n', plan)}");
        }
    }

    /// <summary>Two recordings of one round, and one on its own, with players in both.</summary>
    private async Task SeedAsync()
    {
        var a = await fixture.UploadAsync(RecordingFixture.Midway("a"));
        var b = await fixture.UploadAsync(RecordingFixture.Midway("b"));
        await fixture.UploadAsync(RecordingFixture.Midway("c"));
        var ids = await fixture.Db.Recordings.Where(r => r.Slug == a.Slug || r.Slug == b.Slug).Select(r => r.Id).ToListAsync();
        fixture.Db.RecordingRoundLinks.Add(new RecordingRoundLink
        {
            RecordingId = ids.Min(), OtherRecordingId = ids.Max(), Kind = RecordingRoundLinkKind.Detected,
            OffsetSeconds = 0, CreatedAt = RecordingFixture.Start,
        });
        await fixture.Db.SaveChangesAsync();
        await fixture.Db.Recordings.Where(r => ids.Contains(r.Id)).ExecuteUpdateAsync(set => set.SetProperty(r => r.RoundId, ids.Min()));
    }

    public static TheoryData<string?, string?, string?> NarrowedLists => new()
    {
        { null, null, "Lapu" },
        { "MoonGamers.com | Est. 2004", null, null },
        { null, "skandia", null },
        { null, "skandia", "Rut" },
    };

    [Theory]
    [MemberData(nameof(NarrowedLists))]
    public async Task A_narrowed_list_reads_no_whole_table(string? server, string? uploader, string? player)
    {
        await SeedAsync();

        AssertNoTableScan(await PlansOf(RecordingFilter.From(server, uploader, player)));
    }

    /// <summary>
    /// The whole feed pages by an index on the cards the triggers keep (features/replay-feed,
    /// "Scale"), newest or most viewed, and reads its counts from two tally rows. Walking the
    /// index to a page is a SEARCH or a SCAN of an index that stops at the page's end: a SCAN of
    /// the cards by a covering index is allowed only for that walk, with LIMIT.
    /// </summary>
    [Theory]
    [InlineData(null, "IX_RecordingCards_NewestId")]
    [InlineData("views", "IX_RecordingCards_Views_NewestId")]
    public async Task The_whole_feed_reads_no_whole_table(string? sort, string index)
    {
        await SeedAsync();

        var statements = await PlansOf(RecordingFilter.None, sort);

        var walk = statements.Where(s => s.Sql.Contains("FROM \"RecordingCards\"", StringComparison.Ordinal)).ToList();
        var (walkSql, walkPlan) = Assert.Single(walk);
        Assert.Contains("LIMIT", walkSql, StringComparison.Ordinal);
        // No sort of the cards: the index gives their order, so the walk stops at the page.
        Assert.Matches($"^SCAN \\w+ USING COVERING INDEX {index}$", Assert.Single(walkPlan));
        AssertNoTableScan([.. statements.Except(walk)]);
    }

    public static TheoryData<string?, string?, string?> Filters => new()
    {
        { null, null, null },
        { "MoonGamers.com | Est. 2004", null, null },
        { null, "skandia", null },
        { null, null, "Lapu" },
        { "MoonGamers.com | Est. 2004", "skandia", "Rut" },
    };

    /// <summary>The filter choices: over the whole feed, the first of the tally's index; within
    /// another filter, what that filter finds through its indexes.</summary>
    [Theory]
    [MemberData(nameof(Filters))]
    public async Task The_filter_choices_read_no_whole_table(string? server, string? uploader, string? player)
    {
        await SeedAsync();

        var statements = await PlansOf(async service =>
        {
            var choices = await service.FiltersAsync(RecordingFilter.From(server, uploader, player), default);
            Assert.NotEmpty(choices.Servers);
            Assert.NotEmpty(choices.Uploaders);
        });

        AssertNoTableScan(statements);
    }

    /// <summary>What the triggers run for each card a write touches finds that card's recordings
    /// by index: a view counted costs the same with ten recordings shared as with a million.</summary>
    [Fact]
    public async Task The_card_triggers_read_no_whole_table()
    {
        await SeedAsync();
        var plans = new List<(string Sql, List<string> Plan)>();
        foreach (var statement in RecordingCards.StatementsFor("1"))
        {
            await using var explain = fixture.Connection.CreateCommand();
            // The triggers' own statements, for a card key written here.
#pragma warning disable CA2100
            explain.CommandText = "EXPLAIN QUERY PLAN " + statement;
#pragma warning restore CA2100
            var plan = new List<string>();
            await using (var reader = await explain.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync()) plan.Add(reader.GetString(3));
            }
            plans.Add((statement, plan));
        }

        Assert.Equal(4, plans.Count);
        AssertNoTableScan(plans);
    }
}
