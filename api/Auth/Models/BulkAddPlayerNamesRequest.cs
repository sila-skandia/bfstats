namespace api.Auth.Models;

public class BulkAddPlayerNamesRequest
{
    public List<string> PlayerNames { get; set; } = [];

    /// <summary>When true, all of the user's existing aliases are removed before the new ones are added.</summary>
    public bool ReplaceExisting { get; set; }
}
