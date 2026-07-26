namespace api.Social.Models;

public record CreateTournamentCommentRequest(string Content, string AuthorPlayerName, int? MatchId);
