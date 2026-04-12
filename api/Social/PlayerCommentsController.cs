using System.Security.Claims;
using api.PlayerTracking;
using api.Social.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.Social;

[ApiController]
[Route("stats/players/{playerName}/comments")]
public class PlayerCommentsController(
    PlayerTrackerDbContext context,
    IClock clock,
    ILogger<PlayerCommentsController> logger) : ControllerBase
{
    /// <summary>
    /// Returns all comments for a player profile. Public, no auth required.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PlayerCommentDto>>> GetComments(string playerName)
    {
        var comments = await context.PlayerComments
            .Where(c => c.PlayerName == playerName)
            .Include(c => c.Author)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new PlayerCommentDto(
                c.Id,
                c.PlayerName,
                c.Content,
                c.Author.Email,
                c.CreatedAt,
                c.UpdatedAt))
            .ToListAsync();

        return Ok(comments);
    }

    /// <summary>
    /// Posts a new comment on a player profile. Requires authentication.
    /// </summary>
    [HttpPost]
    [Authorize]
    public async Task<ActionResult<PlayerCommentDto>> CreateComment(
        string playerName,
        [FromBody] CreatePlayerCommentRequest request)
    {
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

        var now = clock.GetCurrentInstant();
        var comment = new PlayerComment
        {
            PlayerName = playerName,
            Content = request.Content.Trim(),
            AuthorUserId = user.Id,
            CreatedAt = now,
            UpdatedAt = now,
        };

        context.PlayerComments.Add(comment);
        await context.SaveChangesAsync();

        logger.LogInformation("User {Email} posted comment on player {PlayerName}", userEmail, playerName);

        var dto = new PlayerCommentDto(
            comment.Id,
            comment.PlayerName,
            comment.Content,
            user.Email,
            comment.CreatedAt,
            comment.UpdatedAt);

        return CreatedAtAction(nameof(GetComments), new { playerName }, dto);
    }

    /// <summary>
    /// Deletes a comment. Author or admin only.
    /// </summary>
    [HttpDelete("{commentId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteComment(string playerName, int commentId)
    {
        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var comment = await context.PlayerComments
            .Include(c => c.Author)
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PlayerName == playerName);

        if (comment == null)
            return NotFound();

        var isAdmin = User.IsInRole("admin") ||
                      userEmail.Equals(Environment.GetEnvironmentVariable("ADMIN_EMAIL"), StringComparison.OrdinalIgnoreCase);

        if (comment.Author.Email != userEmail && !isAdmin)
            return Forbid();

        context.PlayerComments.Remove(comment);
        await context.SaveChangesAsync();

        return NoContent();
    }
}
