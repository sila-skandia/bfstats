using api.Arcade.Models;

namespace api.Arcade;

public interface IArcadeService
{
    Task<IReadOnlyList<ArcadeServerDto>> GetArcadeServersAsync(CancellationToken cancellationToken = default);
    Task<HigherLowerQuestionDto> GetNextHigherLowerQuestionAsync(string? serverGuid = null, string? currentCandidateName = null, string? orbitPlayer = null, CancellationToken cancellationToken = default);
    Task<HigherLowerRevealResultDto> RevealHigherLowerAsync(HigherLowerRevealRequest request, CancellationToken cancellationToken = default);
    Task<MysteryDossierDto> GetDailyMysteryDossierAsync(string? serverGuid = null, string? orbitPlayer = null, CancellationToken cancellationToken = default);
    Task<MysteryDossierDto> GetRandomMysteryDossierAsync(string? serverGuid = null, string? orbitPlayer = null, string? exclude = null, CancellationToken cancellationToken = default);
    Task<MysteryGuessResultDto> GuessMysterySoldierAsync(MysteryGuessRequest request, CancellationToken cancellationToken = default);
    Task<MysteryConcedeResultDto> ConcedeMysterySoldierAsync(MysteryConcedeRequest request, CancellationToken cancellationToken = default);
    Task<TriviaQuizDto> GenerateTriviaQuizAsync(string? serverGuid = null, string? orbitPlayer = null, CancellationToken cancellationToken = default);
    Task<TriviaQuestionVerificationDto> VerifyTriviaQuestionAsync(TriviaVerifyQuestionRequest request, CancellationToken cancellationToken = default);
    Task<TriviaQuizResultDto> VerifyTriviaQuizAsync(TriviaVerifyRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ArcadePlayerSearchDto>> SearchPlayersAsync(string query, string? serverGuid = null, int limit = 10, CancellationToken cancellationToken = default);
}
