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
        }

        return ex.GetType().Name;
    }
}
