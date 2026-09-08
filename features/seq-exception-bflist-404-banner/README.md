# Seq Exceptions page from banner BFList 404s

Webhook: `bfstats/Exceptions` at 2026-09-06 12:51:53Z.
TraceId `b8579a33781a490d2537e32966ac46c9`.

## What fired

Not an application exception. OpenTelemetry's HttpClient instrumentation recorded
an ERROR span for:

`GET https://api.bflist.io/v2/bf1942/servers/153.223.78.15:14567` → 404

Parent request:

`GET /stats/servers/CHASABA Main BF1942 Server/banner.png?style=reticle&w=960`
finished **200** in **289ms** (PNG 31044 bytes). Tickets were dropped; the
banner still painted from SQLite.

Same host + same stale IP also paged on 2026-09-05 13:42
(TraceId `349c26cae6217489147eabb765fef36d`, 1.3s, Rounds 839ms).

## Why the IP was wrong

Liveservers and `/stats/servers/{name}` both show CHASABA at
`153.207.118.175:14567` (guid `41df403-77c3e1b-277b6c0-55e5f5b`), online, with
tickets. The banner used `FirstOrDefault` by name and hit a duplicate
`Servers` row that still held `153.223.78.15`. BFList no longer lists that
address, so every embed refresh (`_t=` cache-buster) 404s and Seq pages
because `@Exception is not null` matches the empty-Exception ERROR span.

## Fix

1. Resolve the banner's `Servers` row as online + most recently seen.
2. Read tickets (and the painted `ip:port`) from the warm live snapshot
   when the landing-page cache already has that name — no extra BFList call.
3. Treat a single-server 404 as "not listed", cache the miss for 8s, and
   unset the HttpClient span status for `api.bflist.io` 404s so leftover
   offline lookups do not page Exceptions.
