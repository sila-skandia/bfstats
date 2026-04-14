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
[Route("stats/servers/{serverName}/comments")]
public class ServerCommentsController(
    PlayerTrackerDbContext context,
    IClock clock,
    ILogger<ServerCommentsController> logger) : ControllerBase
{
    private static readonly HtmlSanitizer Sanitizer = new HtmlSanitizer();
    private const int DefaultPageSize = 10;

    static ServerCommentsController()
    {
        Sanitizer.AllowedTags.Clear();
        foreach (var tag in new[] { "p", "strong", "em", "u", "a", "img", "ul", "ol", "li", "br", "blockquote" })
            Sanitizer.AllowedTags.Add(tag);
        Sanitizer.AllowedAttributes.Clear();
        foreach (var attr in new[] { "href", "src", "alt", "target", "rel" })
            Sanitizer.AllowedAttributes.Add(attr);
    }

    /// <summary>
    /// Returns a page of comments for a server. Public, no auth required.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<PagedServerCommentsDto>> GetComments(
        string serverName,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 50) pageSize = DefaultPageSize;

        var query = context.ServerComments
            .Where(c => c.ServerName == serverName)
            .OrderByDescending(c => c.CreatedAt);

        var totalCount = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => new ServerCommentDto(
                c.Id,
                c.ServerName,
                c.Content,
                c.AuthorPlayerName,
                c.CreatedAt,
                c.UpdatedAt))
            .ToListAsync();

        return Ok(new PagedServerCommentsDto(items, totalCount, page, pageSize, Math.Max(1, totalPages)));
    }

    /// <summary>
    /// Posts a new comment on a server. Requires authentication.
    /// AuthorPlayerName must be one of the user's linked player profiles.
    /// </summary>
    [HttpPost]
    [Authorize]
    public async Task<ActionResult<ServerCommentDto>> CreateComment(
        string serverName,
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

        var linkedName = user.PlayerNames
            .FirstOrDefault(p => p.PlayerName.Equals(request.AuthorPlayerName, StringComparison.OrdinalIgnoreCase));

        if (linkedName == null)
            return BadRequest(new { message = "Selected player profile is not linked to your account." });

        var now = clock.GetCurrentInstant();
        var sanitizedContent = Sanitizer.Sanitize(request.Content.Trim());
        var comment = new ServerComment
        {
            ServerName = serverName,
            Content = sanitizedContent,
            AuthorUserId = user.Id,
            AuthorPlayerName = linkedName.PlayerName,
            CreatedAt = now,
            UpdatedAt = now,
        };

        context.ServerComments.Add(comment);
        await context.SaveChangesAsync();

        logger.LogInformation("User {Email} posted comment on server {ServerName} as {AuthorPlayerName}",
            userEmail, serverName, linkedName.PlayerName);

        return CreatedAtAction(nameof(GetComments), new { serverName }, new ServerCommentDto(
            comment.Id,
            comment.ServerName,
            comment.Content,
            comment.AuthorPlayerName,
            comment.CreatedAt,
            comment.UpdatedAt));
    }

    /// <summary>
    /// Edits a comment's content. Author only.
    /// </summary>
    [HttpPatch("{commentId:int}")]
    [Authorize]
    public async Task<ActionResult<ServerCommentDto>> EditComment(
        string serverName,
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

        var comment = await context.ServerComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.ServerName == serverName);

        if (comment == null)
            return NotFound();

        if (comment.AuthorUserId != user.Id)
            return Forbid();

        comment.Content = Sanitizer.Sanitize(request.Content.Trim());
        comment.UpdatedAt = clock.GetCurrentInstant();
        await context.SaveChangesAsync();

        return Ok(new ServerCommentDto(
            comment.Id,
            comment.ServerName,
            comment.Content,
            comment.AuthorPlayerName,
            comment.CreatedAt,
            comment.UpdatedAt));
    }

    /// <summary>
    /// Deletes a comment. Author or admin only.
    /// </summary>
    [HttpDelete("{commentId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteComment(string serverName, int commentId)
    {
        var userEmail = User.FindFirstValue(ClaimTypes.Email);
        if (userEmail == null)
            return Unauthorized();

        var user = await context.Users.FirstOrDefaultAsync(u => u.Email == userEmail);
        if (user == null)
            return Unauthorized();

        var comment = await context.ServerComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.ServerName == serverName);

        if (comment == null)
            return NotFound();

        var isAdmin = userEmail.Equals(
            Environment.GetEnvironmentVariable("ADMIN_EMAIL"),
            StringComparison.OrdinalIgnoreCase);

        if (comment.AuthorUserId != user.Id && !isAdmin)
            return Forbid();

        context.ServerComments.Remove(comment);
        await context.SaveChangesAsync();

        return NoContent();
    }
}
