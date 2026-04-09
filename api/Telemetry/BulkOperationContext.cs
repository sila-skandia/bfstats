using System.Threading;

namespace api.Telemetry;

public static class BulkOperationContext
{
    private static readonly AsyncLocal<int> Depth = new();

    public static bool IsActive => Depth.Value > 0;

    public static IDisposable Begin()
    {
        Depth.Value++;
        return new Scope();
    }

    private sealed class Scope : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            if (Depth.Value > 0)
            {
                Depth.Value--;
            }

            _disposed = true;
        }
    }
}
