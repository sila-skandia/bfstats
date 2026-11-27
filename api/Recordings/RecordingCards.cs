namespace api.Recordings;

/// <summary>
/// The whole feed's cards and counts, kept in step with <c>Recordings</c> by SQLite triggers
/// (features/replay-feed, "Scale"). Every write to a recording, by EF, by <c>ExecuteUpdate</c>,
/// by a cascade, or by hand, moves the cards it touches, so no writer has to remember to.
/// <para>
/// A recording change touches at most two cards: the one its old row was on and the one its new
/// row is on. Each trigger works those out again from the recordings on them, so the result does
/// not depend on what the tables held before or on the order a statement visits its rows. The
/// counts (<see cref="Models.RecordingTally"/>) follow the card and name rows by their own triggers.
/// </para>
/// <para>
/// A database built by <c>EnsureCreated</c> (the E2E seed, the tests) gets the tables from the
/// model but not the triggers: run <see cref="TriggersSql"/> on it before writing a recording.
/// It creates nothing that is there already. A change to the triggers needs a migration that
/// drops and creates them again.
/// </para>
/// </summary>
public static class RecordingCards
{
    private const int Server = (int)Models.RecordingTallyKind.Server;
    private const int Uploader = (int)Models.RecordingTallyKind.Uploader;
    private const int Cards = (int)Models.RecordingTallyKind.Cards;
    private const int Recordings = (int)Models.RecordingTallyKind.Recordings;

    /// <summary>The triggers, by name, for the model's <c>HasTrigger</c>.</summary>
    public static readonly string[] RecordingTriggers =
        ["TR_Recordings_Cards_Insert", "TR_Recordings_Cards_Delete", "TR_Recordings_Cards_Move", "TR_Recordings_Cards_Views"];

    public static readonly string[] CardTriggers =
        ["TR_RecordingCards_Tally_Insert", "TR_RecordingCards_Tally_Update", "TR_RecordingCards_Tally_Delete"];

    public static readonly string[] NameTriggers = ["TR_RecordingCardNames_Tally_Insert", "TR_RecordingCardNames_Tally_Delete"];

    /// <summary>The listed recordings on the card <paramref name="key"/> whose file is there (an
    /// unlisted one is on no card, features/bfv-through-bfstats, "Access"): those whose
    /// round it is, and the one it is the id of while that one is in no round. Two index lookups;
    /// <c>COALESCE(RoundId, Id) = key</c> would read every row.</summary>
    private static string Members(string key) => $"""
        (SELECT Id, ViewCount, ServerName, UploaderName, Game FROM Recordings WHERE FileMissing = 0 AND Visibility = 0 AND RoundId = {key}
         UNION ALL
         SELECT Id, ViewCount, ServerName, UploaderName, Game FROM Recordings WHERE Id = {key} AND RoundId IS NULL AND FileMissing = 0 AND Visibility = 0)
        """;

    /// <summary>The card <paramref name="key"/> worked out again: gone when nothing is on it. Its
    /// game is its recordings': a round is only ever found among one game's
    /// (features/bfv-through-bfstats).</summary>
    private static string Card(string key) => $"""
            DELETE FROM RecordingCards WHERE CardKey = {key} AND NOT EXISTS (SELECT 1 FROM {Members(key)});
            INSERT INTO RecordingCards (CardKey, Game, NewestId, Views, Recordings)
            SELECT * FROM (SELECT {key} AS CardKey, MAX(Game) AS Game, MAX(Id) AS NewestId, MAX(ViewCount) AS Views, COUNT(*) AS Recordings FROM {Members(key)})
            WHERE NewestId IS NOT NULL
            ON CONFLICT (CardKey) DO UPDATE SET Game = excluded.Game, NewestId = excluded.NewestId, Views = excluded.Views, Recordings = excluded.Recordings
            WHERE Game <> excluded.Game OR NewestId <> excluded.NewestId OR Views <> excluded.Views OR Recordings <> excluded.Recordings;
        """;

    /// <summary>The servers and uploaders on the card <paramref name="key"/> worked out again.</summary>
    private static string Names(string key) => $"""
            DELETE FROM RecordingCardNames WHERE CardKey = {key};
            INSERT INTO RecordingCardNames (CardKey, Game, Kind, Name)
            SELECT {key}, Game, {Server}, ServerName FROM {Members(key)} WHERE ServerName <> ''
            UNION
            SELECT {key}, Game, {Uploader}, UploaderName FROM {Members(key)} WHERE UploaderName <> '';
        """;

    /// <summary>Each statement a trigger runs for the card <paramref name="key"/>, for planning.</summary>
    internal static IEnumerable<string> StatementsFor(string key) =>
        (Card(key) + Names(key)).Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string Add(string game, string kind, string name, string by) => $"""
            INSERT INTO RecordingTallies (Game, Kind, Name, Count) VALUES ({game}, {kind}, {name}, {by})
            ON CONFLICT (Game, Kind, Name) DO UPDATE SET Count = Count + excluded.Count;
        """;

    private const string OldKey = "COALESCE(OLD.RoundId, OLD.Id)";
    private const string NewKey = "COALESCE(NEW.RoundId, NEW.Id)";

    /// <summary>Every trigger, each created only when it is not there.</summary>
    public static readonly string TriggersSql = $"""
        CREATE TRIGGER IF NOT EXISTS {RecordingTriggers[0]} AFTER INSERT ON Recordings
        BEGIN
        {Card(NewKey)}
        {Names(NewKey)}
        END;

        CREATE TRIGGER IF NOT EXISTS {RecordingTriggers[1]} AFTER DELETE ON Recordings
        BEGIN
        {Card(OldKey)}
        {Names(OldKey)}
        END;

        CREATE TRIGGER IF NOT EXISTS {RecordingTriggers[2]} AFTER UPDATE OF RoundId, FileMissing, ServerName, UploaderName, Game, Visibility ON Recordings
        BEGIN
        {Card(OldKey)}
        {Names(OldKey)}
        {Card(NewKey)}
        {Names(NewKey)}
        END;

        CREATE TRIGGER IF NOT EXISTS {RecordingTriggers[3]} AFTER UPDATE OF ViewCount ON Recordings
        WHEN NEW.ViewCount <> OLD.ViewCount AND NEW.FileMissing = 0 AND NEW.Visibility = 0
        BEGIN
        {Card(NewKey)}
        END;

        CREATE TRIGGER IF NOT EXISTS {CardTriggers[0]} AFTER INSERT ON RecordingCards
        BEGIN
        {Add("NEW.Game", $"{Cards}", "''", "1")}
        {Add("NEW.Game", $"{Recordings}", "''", "NEW.Recordings")}
        END;

        CREATE TRIGGER IF NOT EXISTS {CardTriggers[1]} AFTER UPDATE OF Recordings, Game ON RecordingCards
        WHEN NEW.Recordings <> OLD.Recordings OR NEW.Game <> OLD.Game
        BEGIN
        {Add("OLD.Game", $"{Cards}", "''", "-1")}
        {Add("OLD.Game", $"{Recordings}", "''", "-OLD.Recordings")}
        {Add("NEW.Game", $"{Cards}", "''", "1")}
        {Add("NEW.Game", $"{Recordings}", "''", "NEW.Recordings")}
        END;

        CREATE TRIGGER IF NOT EXISTS {CardTriggers[2]} AFTER DELETE ON RecordingCards
        BEGIN
        {Add("OLD.Game", $"{Cards}", "''", "-1")}
        {Add("OLD.Game", $"{Recordings}", "''", "-OLD.Recordings")}
        END;

        CREATE TRIGGER IF NOT EXISTS {NameTriggers[0]} AFTER INSERT ON RecordingCardNames
        BEGIN
        {Add("NEW.Game", "NEW.Kind", "NEW.Name", "1")}
        END;

        CREATE TRIGGER IF NOT EXISTS {NameTriggers[1]} AFTER DELETE ON RecordingCardNames
        BEGIN
        {Add("OLD.Game", "OLD.Kind", "OLD.Name", "-1")}
            DELETE FROM RecordingTallies WHERE Game = OLD.Game AND Kind = OLD.Kind AND Name = OLD.Name AND Count <= 0;
        END;
        """;

    /// <summary>The cards, their names and the counts, from scratch: the recordings shared
    /// before the triggers were. Run with the triggers in place, which fill the counts.</summary>
    public static readonly string BackfillSql = $"""
        DELETE FROM RecordingCardNames;
        DELETE FROM RecordingCards;
        DELETE FROM RecordingTallies;
        INSERT INTO RecordingCards (CardKey, Game, NewestId, Views, Recordings)
        SELECT COALESCE(RoundId, Id), MAX(Game), MAX(Id), MAX(ViewCount), COUNT(*)
        FROM Recordings WHERE FileMissing = 0 AND Visibility = 0
        GROUP BY COALESCE(RoundId, Id);
        INSERT INTO RecordingCardNames (CardKey, Game, Kind, Name)
        SELECT COALESCE(RoundId, Id), Game, {Server}, ServerName FROM Recordings WHERE FileMissing = 0 AND Visibility = 0 AND ServerName <> ''
        UNION
        SELECT COALESCE(RoundId, Id), Game, {Uploader}, UploaderName FROM Recordings WHERE FileMissing = 0 AND Visibility = 0 AND UploaderName <> '';
        """;
}
