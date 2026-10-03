namespace api.AdminData.Models;

/// <summary>
/// The one-time view of an admin-generated temporary password. The plaintext
/// exists only in this response and the admin's hands; the row keeps the hash.
/// </summary>
public record ResetPasswordResponse(int UserId, string Username, string TemporaryPassword);