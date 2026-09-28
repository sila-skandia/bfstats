using System.Globalization;
using System.Text;
using System.Text.Json;

namespace api.tests.Recordings;

/// <summary>
/// A made-up round on one server, and the recordings its clients would have written of it
/// (features/replay-feed, "Rounds"): players come and go, a leaver's pid handed to the next to
/// join; they kill each other and talk, globally, to their side, and the server adverts on a
/// timer; objects are made as they play. <see cref="File"/> writes what one client's recorder
/// keeps of a stretch of it: from the join (the database up to <c>dbComplete</c>) or begun
/// mid-round (held <c>ago</c> records and a roster), on its own clock.
/// </summary>
internal sealed class SyntheticRound
{
    private static readonly string[] Names =
    [
        "skandia", "Rut", "Lapu", "Darko", "Kerem", "Wlk", "zfg", "Uncle Rico", "Nr 9", "Kaspar", "gara", "OWLCAT",
        "SCOURGE", "War Beagle", "_x_ sniper", "Smackeroo", "Volpi", "Hessler", "Goodie", "malsr", "Igy", "Woolly",
        "Section8", "Xena", "Detroit", "Tavington", "Wolfman", "MIga", "Duke", "spoof",
    ];

    private static readonly int[] Weapons = [1379, 1385, 1287, 1280, 2544, 2860, 1375];
    private static readonly string[] Lines = ["gg", "lol", "nice shot", "flag!", "where is the tank", "ty", "rofl", "arty on b"];

    private readonly List<(double T, Dictionary<string, object?> Record)> events = [];
    private readonly Dictionary<int, List<(double From, double To, string Name, int Team)>> tenures = [];

    public SyntheticRound(int seed, double length = 600, string server = "bfstats-lab", string level = "wake",
        string mode = "conquest", int? objectSeed = null, int players = 16)
    {
        Length = length;
        Server = server;
        Level = level;
        Mode = mode;
        var random = new Random(seed);
        var names = new Queue<string>(Names.OrderBy(_ => random.Next()));
        var present = new Dictionary<int, (string Name, int Team, double Since)>();
        for (var pid = 0; pid < players; pid++) present[pid] = (names.Dequeue(), 1 + (pid % 2), 0);

        var next = new Dictionary<string, double>
        {
            ["kill"] = 2 + (random.NextDouble() * 3),
            ["chat"] = 10 + (random.NextDouble() * 20),
            ["team"] = 20 + (random.NextDouble() * 30),
            ["advert"] = 30,
            ["leave"] = 40 + (random.NextDouble() * 20),
        };
        var objects = new Random(objectSeed ?? seed + 1);
        var nextObject = 1.5 + objects.NextDouble();
        var netId = 1000;
        for (var t = 0.0; t < length; t += 0.01)
        {
            var at = Math.Round(t, 3);
            if (at >= nextObject)
            {
                netId += 1 + objects.Next(4);
                Add(at, Event("createObject", ("tid", 1700 + objects.Next(40)), ("netId", netId), ("tmpl", "Soldier")));
                nextObject = at + 1 + (objects.NextDouble() * 2);
            }
            if (at >= next["kill"] && present.Count > 1)
            {
                var pids = present.Keys.Order().ToList();
                var killer = pids[random.Next(pids.Count)];
                var victim = pids.Where(p => p != killer).ElementAt(random.Next(pids.Count - 1));
                var kind = present[killer].Team == present[victim].Team ? 6 : 3;
                Add(at, Event("score", ("kind", kind), ("pid", killer), ("victim", victim), ("weapon", Weapons[random.Next(Weapons.Length)]), ("bodypart", 41)));
                Add(at, Event("score", ("kind", 5), ("pid", victim), ("victim", random.Next(200)), ("weapon", random.Next()), ("bodypart", 0)));
                next["kill"] = at + 0.5 + (random.NextDouble() * 5);
            }
            if (at >= next["chat"] && present.Count > 0)
            {
                var pid = present.Keys.ElementAt(random.Next(present.Count));
                Add(at, Chat(pid, present[pid].Team, $"{present[pid].Name}: {Lines[random.Next(Lines.Length)]}"));
                next["chat"] = at + 15 + (random.NextDouble() * 30);
            }
            if (at >= next["team"] && present.Count > 0)
            {
                var pid = present.Keys.ElementAt(random.Next(present.Count));
                var side = present[pid].Team == 1 ? "axis" : "allies";
                Add(at, Chat(pid, present[pid].Team, $"{present[pid].Name} [{side}]: {Lines[random.Next(Lines.Length)]}"));
                next["team"] = at + 20 + (random.NextDouble() * 40);
            }
            if (at >= next["advert"])
            {
                Add(at, Chat(-1, 0, "*Welcome\u0080to\u0080the\u0080server!\u0080Rules\u0080at\u0080example.com"));
                next["advert"] = at + 60;
            }
            if (at >= next["leave"] && present.Count > 2)
            {
                // A leaver's pid goes to the next to join, a few seconds later.
                var pid = present.Keys.ElementAt(random.Next(present.Count));
                var (name, team, since) = present[pid];
                Tenure(pid, since, at, name, team);
                present.Remove(pid);
                Add(at, Event("destroyPlayer", ("pid", pid)));
                var joinAt = Math.Round(at + 3 + (random.NextDouble() * 5), 3);
                if (joinAt < length && names.Count > 0)
                {
                    var joiner = names.Dequeue();
                    present[pid] = (joiner, team, joinAt);
                    Add(joinAt, Event("createPlayer", ("pid", pid), ("name", joiner), ("team", team), ("ai", 0), ("netId", 300 + pid)));
                    Add(joinAt, Event("setTeam", ("pid", pid), ("team", team)));
                }
                next["leave"] = at + 30 + (random.NextDouble() * 40);
            }
        }
        foreach (var (pid, (name, team, since)) in present) Tenure(pid, since, length, name, team);
        events.Sort((a, b) => a.T.CompareTo(b.T));
    }

    public double Length { get; }
    public string Server { get; }
    public string Level { get; }
    public string Mode { get; }

    /// <summary>Adds an event on the round's clock (a test's own kill, a pid handed on).</summary>
    public void Add(double t, Dictionary<string, object?> record) => events.Add((t, record));

    public void Sort() => events.Sort((a, b) => a.T.CompareTo(b.T));

    /// <summary>
    /// What a client's recorder wrote of <c>[from, to]</c> of the round. From 0 it begins with
    /// the join: the server, the level, the database (everyone playing, the level's own objects)
    /// and <c>dbComplete</c> a second in. Later, it opens with what the recorder kept of the join
    /// (<c>ago</c>) and a roster. Its clock starts at 0 when it begins and runs
    /// <paramref name="drift"/> fast; each event is up to <paramref name="jitter"/> seconds off,
    /// in its order. <paramref name="local"/> is the recording player's pid.
    /// </summary>
    public string File(double from, double to, double drift = 0, double jitter = 0, int seed = 1, int local = 0,
        string? start = null)
    {
        var random = new Random(seed);
        var lines = new List<string>();
        var clock = (double t) => Math.Round(Math.Max(0, t - from) * (1 + drift), 3);
        lines.Add(Json(new Dictionary<string, object?>
        {
            ["k"] = "h", ["v"] = 5, ["plus"] = "2.0",
            ["start"] = start ?? new DateTime(2026, 9, 29, 10, 0, 0).AddSeconds(from).ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture),
            ["hz"] = 10,
        }));
        var join = new[]
        {
            Event("serverInfo", ("mapId", "BF1942"), ("mod", "bf1942"), ("gameId", "BF1942")),
            Event("serverName", ("name", Server)),
            Event("setLevel", ("level", $"bf1942/levels/{Level}/"), ("mode", $"{Mode}.con")),
        };
        if (from <= 0)
        {
            foreach (var e in join) lines.Add(Json(With(e, 0)));
            foreach (var (pid, name, team) in PlayersAt(0)) lines.Add(Json(With(Event("createPlayer", ("pid", pid), ("name", name), ("team", team), ("ai", 0)), 0.4)));
            // The level's own objects, the same ids every time it loads.
            for (var id = 500; id < 530; id++) lines.Add(Json(With(Event("createObject", ("tid", 3000 + id), ("netId", id), ("tmpl", "Level")), 0.5)));
            lines.Add(Json(With(Event("dbComplete"), 1.0)));
        }
        else
        {
            var ago = (double t) => Math.Round(from - t, 3);
            foreach (var e in join) lines.Add(Json(With(e, 0, ago(0))));
            var standing = PlayersAt(from).ToList();
            foreach (var (pid, name, team) in standing)
            {
                lines.Add(Json(With(Event("createPlayer", ("pid", pid), ("name", name), ("team", team), ("ai", 0)), 0, 1)));
            }
            for (var id = 500; id < 530; id++) lines.Add(Json(With(Event("createObject", ("tid", 3000 + id), ("netId", id), ("tmpl", "Level")), 0, ago(0))));
            var roster = standing.Select(p => new object[] { p.Pid, p.Team, 0, p.Name, p.Pid == local ? 1 : 0 }).ToList();
            lines.Add(Json(new Dictionary<string, object?> { ["k"] = "roster", ["t"] = 0, ["p"] = roster }));
        }
        var live = events.Where(e => e.T > Math.Max(from, 1.0) && e.T <= to).ToList();
        // Jittered times handed out in order: the order holds, as it does on a client.
        var times = live.Select(e => Math.Max(0, Math.Round(clock(e.T) + ((random.NextDouble() * 2) - 1) * jitter, 3))).Order().ToList();
        for (var i = 0; i < live.Count; i++) lines.Add(Json(With(live[i].Record, times[i])));
        lines.Add(Json(new Dictionary<string, object?> { ["k"] = "end", ["t"] = clock(to) }));
        return string.Join('\n', lines) + "\n";
    }

    /// <summary>Who is playing at <paramref name="t"/>.</summary>
    public IEnumerable<(int Pid, string Name, int Team)> PlayersAt(double t) =>
        tenures.SelectMany(kv => kv.Value.Where(x => x.From <= t && t < x.To).Select(x => (kv.Key, x.Name, x.Team)))
            .OrderBy(p => p.Key);

    private void Tenure(int pid, double from, double to, string name, int team)
    {
        if (!tenures.TryGetValue(pid, out var list)) tenures[pid] = list = [];
        list.Add((from, to, name, team));
    }

    public static Dictionary<string, object?> Event(string name, params (string Key, object? Value)[] fields)
    {
        var record = new Dictionary<string, object?> { ["k"] = "e", ["e"] = name };
        foreach (var (key, value) in fields) record[key] = value;
        return record;
    }

    public static Dictionary<string, object?> Chat(int pid, int team, string text) =>
        new() { ["k"] = "chat", ["pid"] = pid, ["team"] = team, ["text"] = text };

    private static Dictionary<string, object?> With(Dictionary<string, object?> record, double t, double? ago = null)
    {
        var copy = new Dictionary<string, object?> { ["k"] = record["k"], ["t"] = t };
        foreach (var (key, value) in record)
        {
            if (key is not ("k" or "t")) copy[key] = value;
        }
        if (ago is { } seconds) copy["ago"] = seconds;
        return copy;
    }

    private static string Json(Dictionary<string, object?> record) => JsonSerializer.Serialize(record);

    /// <summary>A recording as the inspector reads it, fingerprint and all.</summary>
    public static async Task<api.Recordings.Models.RecordingInspection> InspectAsync(string text)
    {
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(text));
        return await api.Recordings.RecordingInspector.InspectAsync(stream, null, long.MaxValue, CancellationToken.None);
    }
}
