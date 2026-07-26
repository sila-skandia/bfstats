using System.Security.Claims;
using api.PlayerTracking;
using api.Social.Models;
using Ganss.Xss;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.Social;

[ApiController]
[Route("stats/tournaments/{idOrName}/comments")]
public class TournamentCommentsController(
    PlayerTrackerDbContext context,
    IClock clock,
    ILogger<TournamentCommentsController> logger) : ControllerBase
{
    private static readonly HtmlSanitizer Sanitizer = new HtmlSanitizer();

    static TournamentCommentsController()
    {
        Sanitizer.AllowedTags.Clear();
        foreach (var tag in new[] { "p", "strong", "em", "u", "a", "img", "ul", "ol", "li", "br", "blockquote" })
            Sanitizer.AllowedTags.Add(tag);
        Sanitizer.AllowedAttributes.Clear();
        foreach (var attr in new[] { "href", "src", "alt", "target", "rel" })
            Sanitizer.AllowedAttributes.Add(attr);
    }

    private const int DefaultPageSize = 10;

    /// <summary>
    /// Resolves a tournament by numeric ID, slug, or name.
    /// </summary>
    private async Task<int?> ResolveTournamentIdAsync(string idOrName)
    {
        if (int.TryParse(idOrName, out int id))
        {
            var exists = await context.Tournaments.AnyAsync(t => t.Id == id);
            return exists ? id : null;
        }

        var bySlug = await context.Tournaments
            .Where(t => t.Slug == idOrName)
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync();
        if (bySlug != null) return bySlug;

        return await context.Tournaments
            .Where(t => t.Name == idOrName)
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Returns a page of comments for a tournament, or for a specific match within it
    /// when matchId is provided. Public, no auth required.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<PagedTournamentCommentsDto>> GetComments(
        string idOrName,
        [FromQuery] int? matchId = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize)
    {
        var tournamentId = await ResolveTournamentIdAsync(idOrName);
        if (tournamentId == null)
            return NotFound(new { message = "Tournament not found" });

        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 50) pageSize = DefaultPageSize;

        var query = context.TournamentComments
            .Where(c => c.TournamentId == tournamentId && c.MatchId == matchId)
            .OrderByDescending(c => c.CreatedAt);

        var totalCount = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => new TournamentCommentDto(
                c.Id,
                c.TournamentId,
                c.MatchId,
                c.Content,
                c.AuthorPlayerName,
                c.CreatedAt,
                c.UpdatedAt))
            .ToListAsync();

        return Ok(new PagedTournamentCommentsDto(items, totalCount, page, pageSize, totalPages));
    }

    /// <summary>
    /// Posts a new comment on a tournament, or on a specific match when matchId is set.
    /// Requires authentication. AuthorPlayerName must be one of the user's linked player profiles.
    /// </summary>
    [HttpPost]
    [Authorize]
    public async Task<ActionResult<TournamentCommentDto>> CreateComment(
        string idOrName,
        [FromBody] CreateTournamentCommentRequest request)
    {
        var tournamentId = await ResolveTournamentIdAsync(idOrName);
        if (tournamentId == null)
            return NotFound(new { message = "Tournament not found" });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { message = "Comment content cannot be empty." });

        if (request.Content.Length > 2000)
            return BadRequest(new { message = "Comment content cannot exceed 2000 characters." });

        if (string.IsNullOrWhiteSpace(request.AuthorPlayerName))
            return BadRequest(new { message = "A player profile must be selected." });

        if (request.MatchId.HasValue)
        {
            var matchBelongsToTournament = await context.TournamentMatches
                .AnyAsync(m => m.Id == request.MatchId.Value && m.TournamentId == tournamentId);
            if (!matchBelongsToTournament)
                return BadRequest(new { message = "Match not found in this tournament." });
        }

        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users
            .Include(u => u.PlayerNames)
            .FirstOrDefaultAsync(u => u.Email == userEmail);

        if (user == null)
            return Unauthorized();

        var linkedName = user.PlayerNames
            .FirstOrDefault(p => p.PlayerName.Equals(request.AuthorPlayerName, StringComparison.OrdinalIgnoreCase));

        if (linkedName == null)
            return BadRequest(new { message = "Selected player profile is not linked to your account." });

        var now = clock.GetCurrentInstant();
        var sanitizedContent = Sanitizer.Sanitize(request.Content.Trim());
        var comment = new TournamentComment
        {
            TournamentId = tournamentId.Value,
            MatchId = request.MatchId,
            Content = sanitizedContent,
            AuthorUserId = user.Id,
            AuthorPlayerName = linkedName.PlayerName,
            CreatedAt = now,
            UpdatedAt = now,
        };

        context.TournamentComments.Add(comment);
        await context.SaveChangesAsync();

        logger.LogInformation(
            "User {Email} posted comment on tournament {TournamentId} (match {MatchId}) as {AuthorPlayerName}",
            userEmail, tournamentId, request.MatchId, linkedName.PlayerName);

        var dto = new TournamentCommentDto(
            comment.Id,
            comment.TournamentId,
            comment.MatchId,
            comment.Content,
            comment.AuthorPlayerName,
            comment.CreatedAt,
            comment.UpdatedAt);

        return CreatedAtAction(nameof(GetComments), new { idOrName }, dto);
    }

    /// <summary>
    /// Edits a comment's content. Author only.
    /// </summary>
    [HttpPatch("{commentId:int}")]
    [Authorize]
    public async Task<ActionResult<TournamentCommentDto>> EditComment(
        string idOrName,
        int commentId,
        [FromBody] CreateTournamentCommentRequest request)
    {
        var tournamentId = await ResolveTournamentIdAsync(idOrName);
        if (tournamentId == null)
            return NotFound(new { message = "Tournament not found" });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { message = "Comment content cannot be empty." });

        if (request.Content.Length > 2000)
            return BadRequest(new { message = "Comment content cannot exceed 2000 characters." });

        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users.FirstOrDefaultAsync(u => u.Email == userEmail);
        if (user == null)
            return Unauthorized();

        var comment = await context.TournamentComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.TournamentId == tournamentId);

        if (comment == null)
            return NotFound();

        if (comment.AuthorUserId != user.Id)
            return Forbid();

        comment.Content = Sanitizer.Sanitize(request.Content.Trim());
        comment.UpdatedAt = clock.GetCurrentInstant();
        await context.SaveChangesAsync();

        return Ok(new TournamentCommentDto(
            comment.Id,
            comment.TournamentId,
            comment.MatchId,
            comment.Content,
            comment.AuthorPlayerName,
            comment.CreatedAt,
            comment.UpdatedAt));
    }

    /// <summary>
    /// Deletes a comment. Author (by user account) or admin only.
    /// </summary>
    [HttpDelete("{commentId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteComment(string idOrName, int commentId)
    {
        var tournamentId = await ResolveTournamentIdAsync(idOrName);
        if (tournamentId == null)
            return NotFound(new { message = "Tournament not found" });

        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users.FirstOrDefaultAsync(u => u.Email == userEmail);
        if (user == null)
            return Unauthorized();

        var comment = await context.TournamentComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.TournamentId == tournamentId);

        if (comment == null)
            return NotFound();

        var isAdmin = userEmail.Equals(
            Environment.GetEnvironmentVariable("ADMIN_EMAIL"),
            StringComparison.OrdinalIgnoreCase);

        if (comment.AuthorUserId != user.Id && !isAdmin)
            return Forbid();

        context.TournamentComments.Remove(comment);
        await context.SaveChangesAsync();

        return NoContent();
    }
}
