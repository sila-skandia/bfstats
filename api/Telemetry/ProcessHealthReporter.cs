using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Telemetry;

/// <summary>
/// Samples process CPU and memory on a fixed interval and exposes them as observable gauges.
///
/// The runtime's built-in <c>dotnet.process.cpu.time</c> is a monotonic counter in seconds, and Seq's
/// query language has no rate()/delta() operator — so a counter cannot be turned into a CPU percentage
/// on a Seq dashboard. This service does the differencing in-process and publishes an already-computed
/// utilisation gauge, which charts directly with <c>mean(...)</c>.
/// </summary>
public sealed class ProcessHealthReporter(ILogger<ProcessHealthReporter> logger) : BackgroundService
{
    public const string MeterName = "ProcessHealth";

    private static readonly TimeSpan SampleInterval = TimeSpan.FromSeconds(15);

    private static readonly Meter Meter = new(MeterName, "1.0.0");

    private static double _cpuUtilization;
    private static long _workingSetBytes;
    private static long _managedHeapBytes;

    // OTel semantic-convention names. Seq stores dotted names as nested objects, so these are
    // queried as e.g. process.cpu.utilization — see features/seq-dashboards/README.md.
    private static readonly ObservableGauge<double> CpuUtilization = Meter.CreateObservableGauge(
        "process.cpu.utilization",
        observeValue: () => Volatile.Read(ref _cpuUtilization),
        unit: "1",
        description: "Process CPU time consumed as a fraction of available CPU (0-1)");

    private static readonly ObservableGauge<long> WorkingSet = Meter.CreateObservableGauge(
        "process.memory.usage",
        observeValue: () => Interlocked.Read(ref _workingSetBytes),
        unit: "By",
        description: "Process working set");

    private static readonly ObservableGauge<long> ManagedHeap = Meter.CreateObservableGauge(
        "process.runtime.managed_heap",
        observeValue: () => Interlocked.Read(ref _managedHeapBytes),
        unit: "By",
        description: "Bytes currently allocated on the managed heap");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var process = Process.GetCurrentProcess();

        var lastCpuTime = process.TotalProcessorTime;
        var lastSampledAt = Stopwatch.GetTimestamp();

        using var timer = new PeriodicTimer(SampleInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                process.Refresh();

                var cpuTime = process.TotalProcessorTime;
                var sampledAt = Stopwatch.GetTimestamp();
                var elapsed = Stopwatch.GetElapsedTime(lastSampledAt, sampledAt);

                // ProcessorCount honours the cgroup CPU quota under Kubernetes, so this reads as
                // utilisation of the container's allocation rather than of the whole node.
                var available = elapsed.TotalSeconds * Environment.ProcessorCount;
                if (available > 0)
                {
                    var used = (cpuTime - lastCpuTime).TotalSeconds;
                    Volatile.Write(ref _cpuUtilization, Math.Clamp(used / available, 0d, 1d));
                }

                lastCpuTime = cpuTime;
                lastSampledAt = sampledAt;

                Interlocked.Exchange(ref _workingSetBytes, process.WorkingSet64);
                Interlocked.Exchange(ref _managedHeapBytes, GC.GetTotalMemory(forceFullCollection: false));
            }
            catch (Exception ex)
            {
                // Never let a sampling failure take down the host — the gauges just go stale.
                logger.LogWarning(ex, "Failed to sample process health");
            }
        }
    }
}
