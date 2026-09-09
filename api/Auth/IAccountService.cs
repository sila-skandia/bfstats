using api.Auth.Models;

namespace api.Auth;

/// <summary>
/// Self-service data-subject operations: export everything we hold about an
/// account, and erase it. Both are user-initiated and need no admin involvement,
/// which is what lets the privacy policy point at an in-app control rather than
/// a support queue.
/// </summary>
public interface IAccountService
{
    /// <summary>Builds a portable copy of every piece of account data held for <paramref name="userId"/>.</summary>
    Task<AccountExport?> ExportAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Erases the account. Personal data and preferences are hard-deleted; the
    /// <see cref="PlayerTracking.User"/> row survives as an unidentifiable tombstone
    /// so that public tournament records which reference it stay intact.
    /// Returns null if the account does not exist or is already erased.
    /// </summary>
    Task<AccountDeletionSummary?> DeleteAsync(int userId, CancellationToken cancellationToken = default);
}
