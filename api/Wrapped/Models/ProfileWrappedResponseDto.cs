namespace api.Wrapped.Models;

public record ProfileWrappedResponseDto(
    int UserId,
    int Year,
    PlayerYearInNumbersDto YearInNumbers,
    PlayerTrendDto Trend,
    PlayerFavouriteMapDto FavouriteMap,
    PlayerMedalsDto Medals,
    List<PlayerBestMomentDto> BestMoments,
    List<PlayerTeammateDto> Squad,
    List<PlayerServerRankingDto> ServerRankings,
    PlayerRelationsDto Relations,
    ProfileBestAliasesDto BestAliases,
    List<ProfileAliasCreditDto> AliasCredits
);

public record ProfileBestAliasesDto(
    string BestKdAliasName,
    double BestKdValue,
    string BestKillRateAliasName,
    double BestKillRateValue,
    string BestMapKdMapName,
    double BestMapKdValue
);

public record ProfileAliasCreditDto(
    string PlayerName,
    int RoundsPlayed,
    int TotalKills,
    int TotalDeaths,
    double HoursInCombat,
    double KdRatio
);
