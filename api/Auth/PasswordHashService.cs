using System.Security.Cryptography;

namespace api.Auth;

public interface IPasswordHashService
{
    /// <summary>Hashes a password for storage. Format: pbkdf2-sha256$iterations$salt$hash, all base64.</summary>
    string Hash(string password);

    /// <summary>Constant-time verification against a stored hash string.</summary>
    bool Verify(string password, string storedHash);
}

/// <summary>
/// PBKDF2-HMAC-SHA256. Chosen over BCrypt/Argon2 because it is in the BCL —
/// no new package on a node with no room to spare — and 210k iterations is
/// the OWASP recommendation for PBKDF2-SHA256. This node is SQLite-backed and
/// login is not hot, so the ~100ms cost per attempt is fine, and it is what
/// makes offline cracking of a leaked users table expensive.
/// </summary>
public class PasswordHashService : IPasswordHashService
{
    // Matches OWASP's PBKDF2-SHA256 guidance; bump over time, old rows still
    // verify because the iteration count travels inside the stored string.
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const string Prefix = "pbkdf2-sha256";

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string storedHash)
    {
        var parts = storedHash.Split('$');
        if (parts.Length != 4 || parts[0] != Prefix) return false;

        if (!int.TryParse(parts[1], out var iterations) || iterations < 1) return false;
        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}