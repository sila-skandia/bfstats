using api.StatsCollectors;
using Microsoft.Data.Sqlite;

namespace api.tests.StatsCollectors;

public class SqliteBusyTests
{
    [Theory]
    [InlineData(5)]
    [InlineData(6)]
    public void IsBusy_True_ForSqliteBusyAndLocked(int errorCode)
    {
        var ex = new SqliteException("database is locked", errorCode);
        Assert.True(SqliteBusy.IsBusy(ex));
        Assert.StartsWith($"SQLITE {errorCode}/", SqliteBusy.Describe(ex));
    }

    [Fact]
    public void IsBusy_True_WhenSqliteBusyIsInnerException()
    {
        var inner = new SqliteException("database is locked", 5);
        var wrapped = new InvalidOperationException("save failed", inner);

        Assert.True(SqliteBusy.IsBusy(wrapped));
        Assert.StartsWith("SQLITE 5/", SqliteBusy.Describe(wrapped));
    }

    [Fact]
    public void IsBusy_True_ForAggregateExceptionWrappingSqliteBusy()
    {
        var inner = new SqliteException("database is locked", 5);
        var wrapped = new AggregateException(inner);

        Assert.True(SqliteBusy.IsBusy(wrapped));
        Assert.StartsWith("SQLITE 5/", SqliteBusy.Describe(wrapped));
    }

    [Fact]
    public void IsBusy_False_ForUnrelatedExceptions()
    {
        var ex = new InvalidOperationException("nope");
        Assert.False(SqliteBusy.IsBusy(ex));
        Assert.Equal(nameof(InvalidOperationException), SqliteBusy.Describe(ex));
    }
}
