# Seq Exceptions: notifications connection refused during API Recreate

Webhook: `bfstats/Exceptions` at 2026-09-08 09:52:30Z.
TraceId `10f7dc503859f9b550c178aadfb5464e`.

## What fired

`notifications.Services.BuddyApiService` `LogError(ex)` plus an OpenTelemetry
HttpClient ERROR span:

`GET http://bf42-stats-service.bf42-stats:8080/stats/notification/users-with-favourite-server?...`
→ `HttpRequestException: Connection refused`

Parent: `ServerMapChangeNotification` for guid `1d1680b-3c0e83-a1e6bf3-1ffb030`
(`Battlefield COOP Server`, wake → tobruk). Handler continued with 0 users.

## Why the API refused

`bf42-stats` is one replica, `strategy: Recreate`, `imagePullPolicy: Always`.
Jenkins `rollout restart` deletes the only pod before the next one listens.

Alert window 09:42–09:52 sat inside a ReplicaSet flip-flop (same two hashes
`84b894c8fc` / `6d8fd8bbdf` trading the PVC):

| Time (UTC) | Pod started |
| --- | --- |
| 09:33:54 | `bf42-stats-84b894c8fc-lbw7w` |
| 09:35:06 | `bf42-stats-6d8fd8bbdf-767p6` |
| 09:36:32 | `bf42-stats-84b894c8fc-52kd2` |
| 09:37:34 | `bf42-stats-6d8fd8bbdf-rjd8n` |
| 09:42:33 | `bf42-stats-84b894c8fc-95ftf` |
| 09:43:38 | `bf42-stats-6d8fd8bbdf-swtcz` |
| 09:51:40 | connection refused (swtcz Redis disposed while publishing map change) |
| 09:52:14 | `bf42-stats-84b894c8fc-k85jj` |
| 09:54:46 | `bf42-stats-6d8fd8bbdf-9qctk` |

Same pattern as 13:19–13:57 UTC 09-07 and the 10:02 ranking-shutdown page.
Calls 58s earlier returned 200 in a few milliseconds. Live site after the
bounce: homepage 200, liveservers 200, `lastUpdated` 09:55:21, 87 servers.

Cause of the loop in Jenkins:

- `githubPush()` + `pollSCM('H/5')` can run two API deploys at once
- `rollout status --timeout=120s` is shorter than Recreate + Always-pull
- empty `changeSets` fell back to `git diff LAST_SUCCESS..HEAD`, so a failed
  Recreate left `api/` "changed" forever and poll rebuilt every 5 minutes

## Fix

Notifications (best-effort lookup; skip notify while the API is gone):

- Convert connection refused into HTTP 503 before OpenTelemetry records ERROR
- `LogWarning` without `ex` on that path; do not mark the buddy-api span Error
- Unset remaining HttpClient span status for 503 / transient connect failures
- Drop the HttpClient client span (`error.type` connection / name-resolution /
  secure-connection error to `bf42-stats-service.bf42-stats`) before OTLP
  export. Unset is not enough: .NET records the exception on the Activity, and
  Seq pages `@Exception is not null` regardless of span status.

Jenkins:

- `disableConcurrentBuilds()`
- wait out an in-flight rollout, then restart; status timeout 300s
- poll with empty changeSets does not deploy (use `BUILD_ALL` to force)

Do not live-probe favourite-server from notifications; it is internal.

## 2026-10-19 21:40 UTC page — leftover HttpClient span

Webhook `bfstats/Exceptions`. Window 21:30:15Z–21:40:15Z. DetectedAt 21:40:45Z.
Slow LastCheckTriggered=false.

Single Recreate of the API replica, not a hash flip-flop:

| Time (UTC) | Pod |
| --- | --- |
| 13:36:57 | `bf42-stats-689c8c7b96-pznhc` started |
| 20:28:35 | `bf42-stats-66c68db9bb-k495f` started (no overlapping notify; no page) |
| 21:38:37–39 | notifications `bf42-notifications-9b655b557-7mpfj` connection refused |
| 21:38:49 | `bf42-stats-685bc5c8b9-8fcc8` started |

PR #27's 503 classifier held. Six `LogWarning` without `ex`
(`ServiceUnavailable` for buddy / favourite-server). Parent spans
`GetUsersWithBuddy` / `GetUsersWithFavouriteServer` tagged
`http.status_code=503` and stayed OK. Handlers continued with 0 users.

What still paged: three sampled `System.Net.Http` client spans, EventType
`$A300C501`, Level ERROR, `@Exception` =
`HttpRequestException: Connection refused (bf42-stats-service.bf42-stats:8080)`,
`error.type=connection_error`, elapsed ~2ms.

TraceIds:

- `b2abf17fa8c7b10a78a2956670e03369` buddy BattleBrains (SiMPLE, guadalcanal)
- `3e786bd6edcecc55c43e2d5cfe21b802` favourite `60e81b-54ee3-b3b000-70fcc63` (testing patch, aberdeen → midway)
- `8248704d628359e600a0190842314ab7` favourite `7b3d21-8995d00-acc0849-8995d0` (ECHO, dc basrah nights → dc operation bragg)

No public HTTP 5xx. No Slow. Recovered: notification lookups 200 in ~2ms from
21:40:54Z on `8fcc8`. Collection cycle #10 79 servers / 3584ms at 21:43:23Z.
Live smoke: homepage 200, `GET /stats/liveservers/bf1942/servers` 200,
`lastUpdated` 21:42:50Z, 79 servers.
