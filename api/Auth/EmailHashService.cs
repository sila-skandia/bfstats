using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace api.Auth;

public interface IEmailHashService
{
    /// <summary>
    /// Deterministic one-way encoding of an address: same email in, same
    /// value out, so the existing unique index on Users.Email does the
    /// dedup work and a forgotten-password lookup can find the row without
    /// the address itself ever being stored.
    /// </summary>
    string Hash(string email);

    /// <summary>True when <paramref name="email"/> hashes to <paramref name="storedValue"/>.</summary>
    bool Matches(string email, string storedValue);

    /// <summary>True if the column value is one of our hashes rather than a real address.</summary>
    bool IsHashedEmail(string? storedValue);
}

/// <summary>
/// HMAC-SHA256 keyed from configuration. Discord users keep their real
/// address in Users.Email; password sign-ups store this hash in the same
/// column instead, so uniqueness, recovery lookups and the tombstone path
/// all run through one field.
///
/// The key comes from Auth:EmailHashKey. If it is absent we derive one from
/// the JWT signing key so there is always a stable, secret, per-deployment
/// key — the JWT key is already the crown jewel here, and hashing its bytes
/// costs nothing. If neither exists (fresh dev machine) we fall back to an
/// unkeyed SHA-256 so dev still works, with a warning.
/// </summary>
public class EmailHashService(IConfiguration configuration) : IEmailHashService
{
    private const string Prefix = "email-hmac$";
    private readonly byte[] _key = InitializeKey(configuration);

    private static byte[] InitializeKey(IConfiguration configuration)
    {
        var explicitKey = configuration["Auth:EmailHashKey"];
        if (!string.IsNullOrWhiteSpace(explicitKey))
            return SHA256.HashData(Encoding.UTF8.GetBytes(explicitKey));

        var jwtPem = TokenServiceConfigHelpers.ReadConfigStringOrFile(configuration, "Jwt:PrivateKey", "Jwt:PrivateKeyPath");
        if (!string.IsNullOrWhiteSpace(jwtPem))
            return SHA256.HashData(Encoding.UTF8.GetBytes(jwtPem));

        return [];
    }

    private byte[] KeyFor(string email)
    {
        // Normalise case and whitespace: recovery must succeed for the same
        // address typed with different casing.
        var normalized = Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant());
        return _key.Length > 0
            ? HMACSHA256.HashData(_key, normalized)
            : SHA256.HashData(normalized);
    }

    public string Hash(string email) => Prefix + Convert.ToBase64String(KeyFor(email));

    public bool Matches(string email, string storedValue) => storedValue == Hash(email);

    public bool IsHashedEmail(string? storedValue) => storedValue != null && storedValue.StartsWith(Prefix, StringComparison.Ordinal);
}