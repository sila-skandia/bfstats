using api.Arcade.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace api.Arcade;

[ApiController]
[Route("stats/[controller]")]
public class ArcadeController(
    IArcadeService arcadeService,
    ILogger<ArcadeController> logger) : ControllerBase
{
    /// <summary>
    /// Gets active servers with player counts and candidate regular counts.
    /// </summary>
    [HttpGet("servers")]
    [ProducesResponseType(typeof(IReadOnlyList<ArcadeServerDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ArcadeServerDto>>> GetArcadeServers(
        CancellationToken cancellationToken = default)
    {
        var servers = await arcadeService.GetArcadeServersAsync(cancellationToken);
        return Ok(servers);
    }

    /// <summary>
    /// Gets the next Higher or Lower combatant matchup, optionally filtered to a specific server.
    /// </summary>
    /// <param name="serverGuid">Optional server GUID to filter players and stats to a specific server community.</param>
    /// <param name="currentCandidate">Optional name of the current surviving candidate to carry forward.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    [HttpGet("higher-lower/next")]
    [ProducesResponseType(typeof(HigherLowerQuestionDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<HigherLowerQuestionDto>> GetNextHigherLower(
        [FromQuery] string? serverGuid = null,
        [FromQuery] string? currentCandidate = null,
        [FromQuery] string? orbitPlayer = null,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Fetching next higher-lower matchup (server={ServerGuid}, current={Candidate}, orbit={Orbit})", serverGuid, currentCandidate, orbitPlayer);
        var question = await arcadeService.GetNextHigherLowerQuestionAsync(serverGuid, currentCandidate, orbitPlayer, cancellationToken);
        return Ok(question);
    }

    /// <summary>
    /// Reveals the hidden stat for a Higher or Lower guess.
    /// </summary>
    [HttpPost("higher-lower/reveal")]
    [ProducesResponseType(typeof(HigherLowerRevealResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<HigherLowerRevealResultDto>> RevealHigherLower(
        [FromBody] HigherLowerRevealRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.RoundToken) || string.IsNullOrWhiteSpace(request.Guess))
        {
            return BadRequest("RoundToken and Guess are required.");
        }

        try
        {
            var result = await arcadeService.RevealHigherLowerAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>
    /// Gets today's daily classified dossier for the Mystery Soldier minigame, optionally scoped to a server.
    /// </summary>
    [HttpGet("mystery/today")]
    [ProducesResponseType(typeof(MysteryDossierDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<MysteryDossierDto>> GetDailyMystery(
        [FromQuery] string? serverGuid = null,
        [FromQuery] string? orbitPlayer = null,
        CancellationToken cancellationToken = default)
    {
        var dossier = await arcadeService.GetDailyMysteryDossierAsync(serverGuid, orbitPlayer, cancellationToken);
        return Ok(dossier);
    }

    /// <summary>
    /// Gets a random classified dossier for practice / endless play, optionally scoped to a server.
    /// </summary>
    [HttpGet("mystery/random")]
    [ProducesResponseType(typeof(MysteryDossierDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<MysteryDossierDto>> GetRandomMystery(
        [FromQuery] string? serverGuid = null,
        [FromQuery] string? orbitPlayer = null,
        [FromQuery] string? exclude = null,
        CancellationToken cancellationToken = default)
    {
        var dossier = await arcadeService.GetRandomMysteryDossierAsync(serverGuid, orbitPlayer, exclude, cancellationToken);
        return Ok(dossier);
    }

    /// <summary>
    /// Submits a player name guess against a classified dossier token.
    /// </summary>
    [HttpPost("mystery/guess")]
    [ProducesResponseType(typeof(MysteryGuessResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<MysteryGuessResultDto>> GuessMysterySoldier(
        [FromBody] MysteryGuessRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.DossierToken) || string.IsNullOrWhiteSpace(request.GuessedPlayerName))
        {
            return BadRequest("DossierToken and GuessedPlayerName are required.");
        }

        try
        {
            var result = await arcadeService.GuessMysterySoldierAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>
    /// Generates a dynamic 5-question Field Lore trivia quiz from live and historical statistics,
    /// tailored to a specific server if requested.
    /// </summary>
    [HttpGet("trivia/quiz")]
    [ProducesResponseType(typeof(TriviaQuizDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<TriviaQuizDto>> GenerateTriviaQuiz(
        [FromQuery] string? serverGuid = null,
        [FromQuery] string? orbitPlayer = null,
        CancellationToken cancellationToken = default)
    {
        var quiz = await arcadeService.GenerateTriviaQuizAsync(serverGuid, orbitPlayer, cancellationToken);
        return Ok(quiz);
    }

    /// <summary>
    /// Verifies an individual trivia question answer immediately upon selection.
    /// </summary>
    [HttpPost("trivia/verify-question")]
    [ProducesResponseType(typeof(TriviaQuestionVerificationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<TriviaQuestionVerificationDto>> VerifyTriviaQuestion(
        [FromBody] TriviaVerifyQuestionRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.QuizToken) || string.IsNullOrWhiteSpace(request.QuestionId))
        {
            return BadRequest("QuizToken and QuestionId are required.");
        }

        try
        {
            var result = await arcadeService.VerifyTriviaQuestionAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>
    /// Verifies trivia answers and returns explanations with true historical stats.
    /// </summary>
    [HttpPost("trivia/verify")]
    [ProducesResponseType(typeof(TriviaQuizResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<TriviaQuizResultDto>> VerifyTriviaQuiz(
        [FromBody] TriviaVerifyRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.QuizToken))
        {
            return BadRequest("QuizToken is required.");
        }

        try
        {
            var result = await arcadeService.VerifyTriviaQuizAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    /// <summary>
    /// Fast candidate player autocomplete for mystery soldier guessing, optionally scoped to a server.
    /// </summary>
    [HttpGet("players/search")]
    [ProducesResponseType(typeof(IReadOnlyList<ArcadePlayerSearchDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ArcadePlayerSearchDto>>> SearchPlayers(
        [FromQuery] string? query = null,
        [FromQuery] string? serverGuid = null,
        [FromQuery] int limit = 10,
        CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 50);
        var matches = await arcadeService.SearchPlayersAsync(query ?? "", serverGuid, limit, cancellationToken);
        return Ok(matches);
    }
}
