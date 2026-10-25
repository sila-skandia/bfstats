namespace api.GameProfiles.Models;

/// <summary>
/// The body of <c>PUT stats/account/game-profiles/{name}</c>. <see cref="Files"/>
/// replaces the stored set; <see cref="PlayerName"/>, when missing, is read from
/// <c>GeneralOptions.con</c>.
/// </summary>
public sealed record UpsertGameProfileRequest(
    string? PlayerName,
    Dictionary<string, string?>? Files,
    bool MakeActive = false);
