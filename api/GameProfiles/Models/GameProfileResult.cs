namespace api.GameProfiles.Models;

/// <summary>What a write did: the profile, or why there is none.</summary>
public sealed record GameProfileResult(GameProfileOutcome Outcome, GameProfileResponse? Profile = null, string? Message = null)
{
    public static GameProfileResult Ok(GameProfileResponse? profile = null) => new(GameProfileOutcome.Ok, profile);

    public static GameProfileResult Fail(GameProfileOutcome outcome, string message) => new(outcome, null, message);
}
