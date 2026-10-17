namespace api.AdminData.Models;

public record PagedAdminCommentsResponse(
    List<AdminCommentEntry> Items,
    int TotalCount,
    int ServerCount,
    int PlayerCount,
    int Page,
    int PageSize);
