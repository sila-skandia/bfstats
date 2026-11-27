using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using api.Authorization;
using api.PlayerTracking;

namespace api.Auth;

public interface ITokenService
{
    (string accessToken, DateTime expiresAt) CreateAccessToken(User user);

    /// <summary>An app sign-in's access token (features/app-sign-in), marked with its
    /// <paramref name="client"/>. For a site hosted for someone else (bfv-site) it lives
    /// minutes, not days, and is a plain user's whatever the account's role.</summary>
    (string accessToken, DateTime expiresAt) CreateAppAccessToken(User user, string client);
}

public class TokenService(IConfiguration configuration) : ITokenService
{
    private readonly JwtSecurityTokenHandler _tokenHandler = new();
    private readonly SigningCredentials _signingCredentials = InitializeSigningCredentials(configuration);
    private readonly string _issuer = configuration["Jwt:Issuer"] ?? "";
    private readonly string _audience = configuration["Jwt:Audience"] ?? "";
    private readonly int _accessMinutes = int.TryParse(configuration["Jwt:AccessTokenMinutes"], out var m) ? m : 10080 /* 7 days */;

    /// <summary>bfv-site's tokens: what a revoked bfv sign-in can still do, at most
    /// (features/bfv-through-bfstats). Nothing checks an access token against revoked sessions.</summary>
    private readonly int _siteAccessMinutes = int.TryParse(configuration["Jwt:SiteAccessTokenMinutes"], out var s) ? s : 15;

    /// <summary>The claim an app's access token names its client in.</summary>
    public const string ClientClaim = "client";

    private static RsaSecurityKey InitializeSecurityKey(IConfiguration configuration)
    {
        var privateKeyPem = TokenServiceConfigHelpers.ReadConfigStringOrFile(configuration, "Jwt:PrivateKey", "Jwt:PrivateKeyPath");
        if (string.IsNullOrWhiteSpace(privateKeyPem))
            throw new InvalidOperationException("JWT private key not configured. Set Jwt:PrivateKey (inline PEM) or Jwt:PrivateKeyPath (file path) for RS256.");

        var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);
        return new RsaSecurityKey(rsa);
    }

    private static SigningCredentials InitializeSigningCredentials(IConfiguration configuration)
    {
        var securityKey = InitializeSecurityKey(configuration);
        return new SigningCredentials(securityKey, SecurityAlgorithms.RsaSha256);
    }

    public (string accessToken, DateTime expiresAt) CreateAccessToken(User user) => Create(user, null);

    public (string accessToken, DateTime expiresAt) CreateAppAccessToken(User user, string client) => Create(user, client);

    private (string accessToken, DateTime expiresAt) Create(User user, string? client)
    {
        var now = DateTime.UtcNow;
        var site = client == api.AppSignIn.AppSignInRules.BfvSiteClient;
        var expires = now.AddMinutes(site ? _siteAccessMinutes : _accessMinutes);

        // A site hosted for someone else holds this token in its own pages' script: never more
        // than a plain user's, so an admin who signs in there hands it nothing an admin can do.
        // Nor does it carry the account's email: the configured admin address is an admin by
        // its email claim alone (AppRoles.HasAdminEmail), and bfv's pages need no address.
        var effectiveRole = site ? AppRoles.User
            : AppRoles.IsAdminEmail(user.Email) ? AppRoles.Admin
            : (user.Role ?? AppRoles.User);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Role, effectiveRole),
            new("role", effectiveRole),
            new(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
        };
        if (!site)
        {
            claims.Add(new Claim(JwtRegisteredClaimNames.Email, user.Email));
            claims.Add(new Claim(ClaimTypes.Email, user.Email));
        }
        if (client is not null) claims.Add(new Claim(ClientClaim, client));

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: _signingCredentials
        );

        var jwt = _tokenHandler.WriteToken(token);
        return (jwt, expires);
    }
}

internal static class TokenServiceConfigHelpers
{
    public static string? ReadConfigStringOrFile(IConfiguration config, string valueKey, string pathKey)
    {
        var v = config[valueKey];
        if (!string.IsNullOrWhiteSpace(v)) return DecodePemIfBase64(v);
        var path = config[pathKey];
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            return File.ReadAllText(path);
        }
        return null;
    }

    /// <summary>
    /// If the value is base64-encoded PEM (no -----BEGIN header), decode it.
    /// This allows environment variables to carry PEM keys without newline issues.
    /// </summary>
    private static string DecodePemIfBase64(string value)
    {
        if (value.StartsWith("-----")) return value;
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(value));
    }
}
