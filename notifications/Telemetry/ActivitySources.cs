using System.Diagnostics;

namespace notifications.Telemetry;

public static class ActivitySources
{
    public static readonly ActivitySource Redis = new("Notifications.Redis");
    public static readonly ActivitySource Http = new("Notifications.Http");
    public static readonly ActivitySource SignalR = new("Notifications.SignalR");
    public static readonly ActivitySource Events = new("Notifications.Events");
}
