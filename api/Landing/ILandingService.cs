using api.Landing.Models;

namespace api.Landing;

public interface ILandingService
{
    Task<NetworkPulseResponse> GetNetworkPulseAsync(string? game, int trendHours, CancellationToken cancellationToken = default);
}
