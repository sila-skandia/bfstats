# Seq exception: SignalR idle timeout

`bfstats/Exceptions` pages when `@Exception is not null`. Authenticated
`/hub` connections that go silent for the default 30s
`ClientTimeoutInterval` disconnect with
`OperationCanceledException: Client hasn't sent a message/ping within the
configured ClientTimeoutInterval.`

`NotificationHub.OnDisconnectedAsync` logged that as `LogError(ex, ...)`
and marked the SignalR activity Error. Both events match the signal.
This is an idle client (background tab, laptop sleep, dropped websocket),
not an application failure. It fired about a dozen times across 09-05 and
09-06.

## Change

Expected idle timeouts log at Information without an exception and do not
set the activity status to Error. Unexpected disconnect exceptions still
page.

## 2026-09-06 13:19 UTC page

Trace `091e527be2a123a08476a3cfd77694e8`: connect 13:19:22, disconnect
13:19:52 (exactly 30s). Hub cleaned the Redis connection mapping. Not a
site outage.
