namespace api.StatsCollectors;

internal static class SqliteBusy
{
    public static bool IsBusy(Exception ex)
    {
        if (ex is Microsoft.Data.Sqlite.SqliteException sqliteEx &&
            (sqliteEx.SqliteErrorCode is 5 or 6 ||
             sqliteEx.Message.Contains("database is locked", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (ex is AggregateException aggregate)
        {
            return aggregate.InnerExceptions.Any(IsBusy);
        }

        return ex.InnerException != null && IsBusy(ex.InnerException);
    }

    public static string Describe(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            if (current is Microsoft.Data.Sqlite.SqliteException sqliteEx)
            {
                return $"SQLITE {sqliteEx.SqliteErrorCode}/{sqliteEx.SqliteExtendedErrorCode}";
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    var described = Describe(inner);
                    if (described.StartsWith("SQLITE ", StringComparison.Ordinal))
                    {
                        return described;
                    }
                }
            }
        }

        return ex.GetType().Name;
    }
}
