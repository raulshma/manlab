using System.Security.Cryptography;
using System.Text;

namespace ManLab.Server.Services.Security;

public static class TokenHasher
{
    public static string Sha256Hex(string token)
    {
        if (token is null) throw new ArgumentNullException(nameof(token));

        var bytes = Encoding.UTF8.GetBytes(token);
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash);
    }

    /// <summary>
    /// Normalizes an incoming bearer token to a SHA-256 hex hash.
    /// 
    /// Agents normally send the plain token and the server hashes it.
    /// However, it is easy for operators to accidentally supply the already-hashed value
    /// (e.g., copied from logs/DB). In that case, hashing again will never match.
    /// 
    /// This helper accepts either:
    /// - a plain token (any string) -> returns SHA-256 hex
    /// - a 64-char hex string (case-insensitive) -> returns normalized uppercase hex
    /// - a "sha256:"-prefixed 64-char hex string -> returns normalized uppercase hex
    /// </summary>
    public static string NormalizeToSha256Hex(string tokenOrHash)
    {
        if (tokenOrHash is null) throw new ArgumentNullException(nameof(tokenOrHash));

        var s = tokenOrHash.Trim();
        if (s.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
        {
            s = s["sha256:".Length..].Trim();
        }

        if (IsSha256Hex(s))
        {
            // Ensure consistent casing for DB equality comparisons.
            return s.ToUpperInvariant();
        }

        return Sha256Hex(s);
    }

    private static bool IsSha256Hex(string s)
    {
        // SHA-256 hex is 32 bytes -> 64 hex chars.
        if (s.Length != 64) return false;

        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            var isHex = (c >= '0' && c <= '9')
                        || (c >= 'a' && c <= 'f')
                        || (c >= 'A' && c <= 'F');
            if (!isHex) return false;
        }

        return true;
    }

    public static string CreateToken(int numBytes = 32)
    {
        if (numBytes <= 0) throw new ArgumentOutOfRangeException(nameof(numBytes));

        var bytes = RandomNumberGenerator.GetBytes(numBytes);
        // Base64url without padding
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
