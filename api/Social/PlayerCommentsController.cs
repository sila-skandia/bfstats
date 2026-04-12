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
            .OrderBy(c => c.CreatedAt)
            .Select(c => new PlayerCommentDto(
                c.Id,
                c.PlayerName,
                c.Content,
                c.AuthorPlayerName,
                c.CreatedAt,
                c.UpdatedAt))
            .ToListAsync();

        return Ok(comments);
    }

    /// <summary>
    /// Posts a new comment on a player profile. Requires authentication.
    /// AuthorPlayerName must be one of the user's linked player profiles.
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

        if (string.IsNullOrWhiteSpace(request.AuthorPlayerName))
            return BadRequest(new { message = "A player profile must be selected." });

        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users
            .Include(u => u.PlayerNames)
            .FirstOrDefaultAsync(u => u.Email == userEmail);

        if (user == null)
            return Unauthorized();

        // Validate chosen player name is one the user has linked
        var linkedName = user.PlayerNames
            .FirstOrDefault(p => p.PlayerName.Equals(request.AuthorPlayerName, StringComparison.OrdinalIgnoreCase));

        if (linkedName == null)
            return BadRequest(new { message = "Selected player profile is not linked to your account." });

        var now = clock.GetCurrentInstant();
        var comment = new PlayerComment
        {
            PlayerName = playerName,
            Content = request.Content.Trim(),
            AuthorUserId = user.Id,
            AuthorPlayerName = linkedName.PlayerName,
            CreatedAt = now,
            UpdatedAt = now,
        };

        context.PlayerComments.Add(comment);
        await context.SaveChangesAsync();

        logger.LogInformation("User {Email} posted comment on player {PlayerName} as {AuthorPlayerName}",
            userEmail, playerName, linkedName.PlayerName);

        var dto = new PlayerCommentDto(
            comment.Id,
            comment.PlayerName,
            comment.Content,
            comment.AuthorPlayerName,
            comment.CreatedAt,
            comment.UpdatedAt);

        return CreatedAtAction(nameof(GetComments), new { playerName }, dto);
    }

    /// <summary>
    /// Edits a comment's content. Author only.
    /// </summary>
    [HttpPatch("{commentId:int}")]
    [Authorize]
    public async Task<ActionResult<PlayerCommentDto>> EditComment(
        string playerName,
        int commentId,
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

        var comment = await context.PlayerComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PlayerName == playerName);

        if (comment == null)
            return NotFound();

        if (comment.AuthorUserId != user.Id)
            return Forbid();

        comment.Content = request.Content.Trim();
        comment.UpdatedAt = clock.GetCurrentInstant();
        await context.SaveChangesAsync();

        return Ok(new PlayerCommentDto(
            comment.Id,
            comment.PlayerName,
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
    public async Task<IActionResult> DeleteComment(string playerName, int commentId)
    {
        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users.FirstOrDefaultAsync(u => u.Email == userEmail);
        if (user == null)
            return Unauthorized();

        var comment = await context.PlayerComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PlayerName == playerName);

        if (comment == null)
            return NotFound();

        var isAdmin = userEmail.Equals(
            Environment.GetEnvironmentVariable("ADMIN_EMAIL"),
            StringComparison.OrdinalIgnoreCase);

        if (comment.AuthorUserId != user.Id && !isAdmin)
            return Forbid();

        context.PlayerComments.Remove(comment);
        await context.SaveChangesAsync();

        return NoContent();
    }
}
