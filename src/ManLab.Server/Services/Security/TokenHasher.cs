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
