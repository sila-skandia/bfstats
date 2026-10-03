namespace api.AdminData.Models;

public record UserWithRoleResponse(int UserId, string Email, string Role, string? Username, string AuthProvider);
