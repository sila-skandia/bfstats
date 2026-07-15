namespace api.Auth.Models;

public class BulkAddPlayerNamesResponse
{
    public List<UserPlayerNameResponse> Added { get; set; } = [];
    public List<BulkPlayerNameWarning> Warnings { get; set; } = [];
}
