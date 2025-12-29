using System.Security.Cryptography;
using System.Text;

using ManLab.Server.Services.Persistence;

namespace ManLab.Server.Services;

/// <summary>
/// Service for encrypting and decrypting sensitive credentials (SSH passwords, private keys, etc.)
/// using AES-256-GCM with a data protection key stored in database.
/// </summary>
public sealed class CredentialEncryptionService
{
    private readonly ISettingsService _settingsService;
    private readonly ILogger<CredentialEncryptionService> _logger;

    private const string EncryptionKeyName = "credential_encryption_key";

    public CredentialEncryptionService(
        ISettingsService settingsService,
        ILogger<CredentialEncryptionService> logger)
    {
        _settingsService = settingsService;
        _logger = logger;
    }

    /// <summary>
    /// Encrypts the provided plaintext value using the current encryption key.
    /// </summary>
    public async Task<string> EncryptAsync(string plaintext, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(plaintext))
        {
            return string.Empty;
        }

        var key = await GetOrCreateEncryptionKeyAsync(cancellationToken);
        var iv = new byte[12]; // 96-bit IV for GCM
        var tag = new byte[16]; // 128-bit tag
        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);

        RandomNumberGenerator.Fill(iv);

        var cipherText = new byte[plaintextBytes.Length];

        using var cipher = new AesGcm(key, tag.Length);
        cipher.Encrypt(iv, plaintextBytes, cipherText, tag);

        // Combine IV (12) + Tag (16) + Ciphertext
        var combinedBytes = new byte[iv.Length + tag.Length + cipherText.Length];
        Buffer.BlockCopy(iv, 0, combinedBytes, 0, iv.Length);
        Buffer.BlockCopy(tag, 0, combinedBytes, iv.Length, tag.Length);
        Buffer.BlockCopy(cipherText, 0, combinedBytes, iv.Length + tag.Length, cipherText.Length);

        return Convert.ToBase64String(combinedBytes);
    }

    /// <summary>
    /// Decrypts the provided encrypted value using the current encryption key.
    /// Returns null if decryption fails or the encrypted value is invalid.
    /// </summary>
    public async Task<string?> DecryptAsync(string encrypted, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(encrypted))
        {
            return null;
        }

        try
        {
            var key = await GetOrCreateEncryptionKeyAsync(cancellationToken);
            var combinedBytes = Convert.FromBase64String(encrypted);

            if (combinedBytes.Length < 12 + 16)
            {
                _logger.LogWarning("Encrypted data is too short: {Length} bytes", combinedBytes.Length);
                return null;
            }

            var iv = new byte[12];
            var tag = new byte[16];
            var cipherText = new byte[combinedBytes.Length - iv.Length - tag.Length];

            Buffer.BlockCopy(combinedBytes, 0, iv, 0, iv.Length);
            Buffer.BlockCopy(combinedBytes, iv.Length, tag, 0, tag.Length);
            Buffer.BlockCopy(combinedBytes, iv.Length + tag.Length, cipherText, 0, cipherText.Length);

            var plaintextBytes = new byte[cipherText.Length];

            using var cipher = new AesGcm(key, tag.Length);
            cipher.Decrypt(iv, cipherText, tag, plaintextBytes);

            return Encoding.UTF8.GetString(plaintextBytes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt credential data");
            return null;
        }
    }

    /// <summary>
    /// Gets or creates the encryption key from the database.
    /// The key is stored as a base64-encoded string in SystemSettings.
    /// </summary>
    private async Task<byte[]> GetOrCreateEncryptionKeyAsync(CancellationToken cancellationToken)
    {
        var existingKeyBase64 = await _settingsService.GetValueAsync(EncryptionKeyName);

        if (!string.IsNullOrWhiteSpace(existingKeyBase64))
        {
            try
            {
                return Convert.FromBase64String(existingKeyBase64);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse existing encryption key, will create a new one");
            }
        }

        // Generate a new AES-256 key (32 bytes)
        var newKey = new byte[32];
        RandomNumberGenerator.Fill(newKey);

        var newKeyBase64 = Convert.ToBase64String(newKey);
        await _settingsService.SetValueAsync(EncryptionKeyName, newKeyBase64, "Security", "Encryption key for onboarding credentials");

        _logger.LogInformation("Generated new credential encryption key (stored in SystemSettings)");

        return newKey;
    }

    /// <summary>
    /// Rotates the encryption key by creating a new key and re-encrypting all credentials.
    /// This should be called carefully, ideally during a maintenance window.
    /// </summary>
    public async Task RotateKeyAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting credential encryption key rotation");

        // Create a new key
        var newKey = new byte[32];
        RandomNumberGenerator.Fill(newKey);
        var newKeyBase64 = Convert.ToBase64String(newKey);

        // For now, just log this. In a production scenario, you would:
        // 1. Create a second key ID rotation mechanism
        // 2. Migrate all encrypted data from old key to new key
        // 3. Delete the old key after successful migration
        // This is a placeholder for future key rotation implementation.

        _logger.LogWarning("Key rotation not fully implemented. New key generated but data migration not performed.");

        await Task.CompletedTask;
    }
}
