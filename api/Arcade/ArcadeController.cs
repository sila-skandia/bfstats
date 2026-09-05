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
    private const string UnexpectedArcadeError = "Something went wrong loading this game. Please retry.";

    /// <summary>
    /// Gets active servers with player counts and candidate regular counts.
    /// </summary>
    [HttpGet("servers")]
    [ProducesResponseType(typeof(IReadOnlyList<ArcadeServerDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ArcadeServerDto>>> GetArcadeServers(
        CancellationToken cancellationToken = default)
    {
        try
        {
            var servers = await arcadeService.GetArcadeServersAsync(cancellationToken);
            return Ok(servers);
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "servers");
        }
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
        try
        {
            var question = await arcadeService.GetNextHigherLowerQuestionAsync(serverGuid, currentCandidate, orbitPlayer, cancellationToken);
            return Ok(question);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "higher-lower/next", serverGuid);
        }
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
            return BadRequest(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "higher-lower/reveal");
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
        try
        {
            var dossier = await arcadeService.GetDailyMysteryDossierAsync(serverGuid, orbitPlayer, cancellationToken);
            return Ok(dossier);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "mystery/today", serverGuid);
        }
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
        try
        {
            var dossier = await arcadeService.GetRandomMysteryDossierAsync(serverGuid, orbitPlayer, exclude, cancellationToken);
            return Ok(dossier);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "mystery/random", serverGuid);
        }
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
            return BadRequest(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "mystery/guess");
        }
    }

    /// <summary>
    /// Forfeits the mystery soldier investigation and reveals the classified target identity.
    /// </summary>
    [HttpPost("mystery/reveal")]
    [ProducesResponseType(typeof(MysteryConcedeResultDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<MysteryConcedeResultDto>> RevealMysterySoldier(
        [FromBody] MysteryConcedeRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.DossierToken))
        {
            return BadRequest("DossierToken is required.");
        }

        try
        {
            var result = await arcadeService.ConcedeMysterySoldierAsync(request, cancellationToken);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "mystery/reveal");
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
        try
        {
            var quiz = await arcadeService.GenerateTriviaQuizAsync(serverGuid, orbitPlayer, cancellationToken);
            return Ok(quiz);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "trivia/quiz", serverGuid);
        }
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
            return BadRequest(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "trivia/verify-question");
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
            return BadRequest(SafeClientMessage(ex.Message));
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "trivia/verify");
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
        try
        {
            var matches = await arcadeService.SearchPlayersAsync(query ?? "", serverGuid, limit, cancellationToken);
            return Ok(matches);
        }
        catch (Exception ex)
        {
            return UnexpectedFailure(ex, "players/search", serverGuid);
        }
    }

    private ObjectResult UnexpectedFailure(Exception ex, string operation, string? serverGuid = null)
    {
        logger.LogError(ex, "Arcade {Operation} failed (server={ServerGuid})", operation, serverGuid);
        return StatusCode(StatusCodes.Status500InternalServerError, UnexpectedArcadeError);
    }

    private static string SafeClientMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message) || LooksLikeRawException(message))
        {
            return UnexpectedArcadeError;
        }

        return message.Trim();
    }

    internal static bool LooksLikeRawException(string text)
        => text.Contains('\n', StringComparison.Ordinal)
           || text.Contains('\r', StringComparison.Ordinal)
           || text.Contains("Exception:", StringComparison.OrdinalIgnoreCase)
           || text.Contains("   at ", StringComparison.Ordinal)
           || text.Contains("stack trace", StringComparison.OrdinalIgnoreCase)
           || text.Contains("HEADERS", StringComparison.Ordinal);
}
