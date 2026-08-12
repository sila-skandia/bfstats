# Seq dashboards — traffic + process health

Seq is the only observability backend in the cluster (there is no Prometheus
operator running, so the `/metrics` scrape endpoint and the `ServiceMonitor` in
`deploy/app/service-monitor.yaml` are currently unconsumed).

This doc holds the queries behind two traffic dashboards and one process-health
dashboard, plus the wiring that makes the metrics flow.

---

## Data sources

### Page views (already existed)

`api/Telemetry/TelemetryController.cs` receives a `sendBeacon` POST from the SPA
router (`ui/src/services/telemetryService.ts`) and writes one `PageView` log
event per navigation, with these properties:

| Property | Meaning |
| --- | --- |
| `PageType` | Normalised page category, e.g. `server_details`, `player_details`. Whitelist lives in `TelemetryController.AllowedPageTypes` |
| `PageSlug` | Route identity — server name, player name, round id, tournament id |
| `VisitorId` | `localStorage` id, stable across sessions |
| `SessionId` | `sessionStorage` id, one per tab session |
| `PageRouteName` | Vue route name |
| `PagePath` | Path without query string |
| `PageReferrer` | `document.referrer` |

Bots are dropped before the event is written (`is_bot` activity tag set by
`RequestTelemetryMiddleware`), so no bot predicate is needed in queries.

`PageSlug` holds the **raw** player name, so mojibake names render raw in Seq.
That is intentional — the slug is an identifier, not display text.

### Process CPU/memory (added for this)

`api/Telemetry/ProcessHealthReporter.cs` samples every 15s and publishes three
observable gauges on the `ProcessHealth` meter:

| Metric | Unit | Notes |
| --- | --- | --- |
| `process.cpu.utilization` | ratio 0–1 | Fraction of the container's CPU allocation. Multiply by 100 in queries |
| `process.memory.usage` | bytes | Working set |
| `process.runtime.managed_heap` | bytes | `GC.GetTotalMemory` |

**Why a hand-rolled CPU gauge:** the runtime's built-in
`dotnet.process.cpu.time` is a monotonic counter in seconds, and Seq's query
language has no `rate()`/`delta()`. A counter cannot be turned into a percentage
on a Seq chart, so the differencing happens in-process and Seq only ever sees an
already-computed utilisation value.

The runtime instrumentation meters (`dotnet.gc.*`, `dotnet.thread_pool.*`) are
also exported and available if you want to go deeper.

---

## Wiring

1. **Seq must opt in to metric ingestion.** `SEQ_FEATURES_ENABLED=IngestOtlpMetrics`
   is set in both `deploy/app/seq-deployment.yaml` and `docker-compose.dev.yml`.
   Without it Seq returns an error on `POST /ingest/otlp/v1/metrics`.
2. **The API exports metrics over OTLP.** `Program.cs` adds an
   `AddOtlpExporter` to the metrics pipeline on a 30s interval, pointed at
   `OTLP_METRICS_ENDPOINT`, defaulting to `{SEQ_URL}/ingest/otlp/v1/metrics`.

   This deliberately does **not** reuse `OTLP_ENDPOINT` — that variable is
   trace-specific and may point at Tempo, which is a different backend.
   If `SEQ_URL` is unset the exporter is not registered at all.

Seq stores each metric sample as a wide event, with the value in a property
named after the metric. Dotted names become nested objects, so
`process.cpu.utilization` is queried with that dotted path directly.

---

## Signal

Create a signal named **Page Views** with filter `Has(PageType)` and attach it to
both traffic dashboards, so individual charts don't repeat the predicate.

## A note on time ranges

The queries below carry no `@Timestamp` predicate — the dashboard supplies the
range from its own picker. If you run them through the HTTP API (`GET /api/data`)
instead, Seq rejects any `group by time()` query without an explicit lower bound,
so append `and @Timestamp >= Now() - 1h`.

---

## Dashboard: Servers

**Server page views over time** — chart type: **line**

```
select count(*) as Views
from stream
where PageType in ['server_details', 'server_sessions', 'server_list']
group by time(1h)
```

**Most-visited servers** — chart type: **bar**

```
select count(*) as Views
from stream
where PageType = 'server_details'
group by PageSlug
order by Views desc
limit 15
```

**Unique visitors hitting server pages** — chart type: **line**

```
select count(distinct(VisitorId)) as Visitors
from stream
where PageType in ['server_details', 'server_sessions', 'server_list']
group by time(1d)
```

`distinct(x)` on its own returns the set of values, not a count — it must be
wrapped in `count(...)` or the chart renders visitor ids instead of a number.

---

## Dashboard: Players

**Most-viewed players** — chart type: **bar**

```
select count(*) as Views
from stream
where PageType = 'player_details'
group by PageSlug
order by Views desc
limit 15
```

**Player traffic by sub-page** — chart type: **line**, one series per page type

```
select count(*) as Views
from stream
where PageType in ['player_details', 'player_sessions', 'player_achievements', 'player_network', 'player_comparison', 'players']
group by PageType, time(1h)
```

**Where attention goes overall** — chart type: **pie**

```
select count(*) as Views
from stream
where Has(PageType)
group by PageType
order by Views desc
```

---

## Dashboard: Process health

All scoped to the API by `@Resource.service.name = 'api'` — the notifications
service does not export metrics.

**These select `from series`, not `from stream`.** Metric samples and log events
live in separate query sources. Querying metrics `from stream` is not an error —
it returns a well-formed result with `null` in every slice, which looks exactly
like "no data has arrived yet". Verified on Seq 2026.1.17083: `from stream`
returned all-null while `from series` returned real values for the same samples.

The traffic queries above stay on `from stream`, because `PageView` is a log
event rather than a metric.

`SEQ_FEATURES_ENABLED=IngestOtlpMetrics` appears to be a no-op on 2026.1 —
`/ingest/otlp/v1/metrics` returns 200 and `EnabledFeatures` reports `None`, with
no feature-flag line at startup. The setting is harmless and still required on
2025.x, so it is left in place.

**CPU** — chart type: **line**

```
select mean(process.cpu.utilization) * 100 as CpuPercent
from series
where @Resource.service.name = 'api'
group by time(1m)
```

**Memory** — chart type: **line**, two series

```
select
  mean(process.memory.usage) / 1048576 as WorkingSetMB,
  mean(process.runtime.managed_heap) / 1048576 as ManagedHeapMB
from series
where @Resource.service.name = 'api'
group by time(1m)
```

**Peak CPU in the window** — chart type: **value**

```
select max(process.cpu.utilization) * 100 as PeakCpuPercent
from series
where @Resource.service.name = 'api'
```

### Verified

All queries in this doc were run against a throwaway Seq 2025.2 instance with
`IngestOtlpMetrics` enabled, using real exported metrics from a local API run and
seeded `PageView` events. Sample output — CPU 2.8% → 4.6%, working set 241MB →
265MB, managed heap ~39MB.

### Correlating spikes with background jobs

`BackgroundJobMetrics` already exports `bg_job_executions_total` and
`bg_job_duration_seconds` on the `BackgroundJobs` meter, which now reach Seq via
the same OTLP exporter. Overlay them on the CPU chart to answer "which job was
running when memory spiked?".
