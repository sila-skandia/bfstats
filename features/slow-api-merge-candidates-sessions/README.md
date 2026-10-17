# Slow `GET /stats/admin/data/servers/merge-candidates`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 04:43 UTC 2026-10-11.

## Trace

`GET /stats/admin/data/servers/merge-candidates?game=bf1942` HTTP 200 **12,988ms**.
TraceId `abaf61f9fa6b08862772b41eeb00dadd`. Chrome Linux, not a bot. Host `bfstats.io`.
Pod `bf42-stats-58994ccf96-cgc74`.

| hop | elapsed | SQL |
|---|---|---|
| `Servers` catalog | 0ms | `WHERE Game = @gameParam` |
| `PlayerSessions` COUNT/MIN/MAX | **9,320ms** | `WHERE NOT IsDeleted AND ServerGuid IN (20 GUIDs) GROUP BY ServerGuid` |
| `PlayerServerStats` SUM playtime | 3,061ms | same 20-GUID IN-list |

Request 04:42:38–51Z. Collection #5560 at 04:43:01 was 3.4s. Hourly incremental
on this pod lands around :25, so not writer overlap.

The 09-06 rewrite in
[slow-api-merge-candidates-network-graph](../slow-api-merge-candidates-network-graph/README.md)
is the running image: Servers group in memory, then session stats only for the
duplicate GUIDs. It still walks `PlayerSessions` for those GUIDs. On the Hetzner
volume each table fetch is ~1.38ms, and a busy duplicate GUID has enough rows
that the IN-list is another ~10s scan.

## Change

Count and first/last come from `Rounds` (`COUNT(*)`, `MIN(StartTime)`,
`MAX(StartTime)`). That stays on `IX_Rounds_ServerGuid_StartTime` without
touching `IsDeleted` or `EndTime`, so SQLite does not table-fetch. Playtime
stays on `PlayerServerStats`. No new index.

The admin table labelled the count "sessions"; it is now round count, which is
what the page ranks besides playtime.

Hop log:

`Merge candidates game {Game} guids {GuidCount}: {GroupCount} groups in {ElapsedMs}ms (rounds {RoundsMs}ms, playtime {PlaytimeMs}ms)`

Do not live-probe `GET /stats/admin/data/servers/merge-candidates`. After this
is live, a still >=10s page whose new log shows `rounds` or `playtime` still
>=10s is a new bug — do not put `PlayerSessions` back on this path. A slow
page with no new log is the old image.
