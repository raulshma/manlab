using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services.Security;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services;

public sealed class EnrollmentTokenService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromHours(2);

    private readonly DataContext _db;

    public EnrollmentTokenService(DataContext db)
    {
        _db = db;
    }

    public async Task<(string PlainToken, EnrollmentToken TokenEntity)> CreateAsync(Guid? machineId, CancellationToken cancellationToken = default)
    {
        // Ensure uniqueness by retrying a few times.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var plain = TokenHasher.CreateToken();
            var hash = TokenHasher.Sha256Hex(plain);

            var exists = await _db.EnrollmentTokens.AnyAsync(t => t.TokenHash == hash, cancellationToken);
            if (exists)
            {
                continue;
            }

            var entity = new EnrollmentToken
            {
                Id = Guid.NewGuid(),
                TokenHash = hash,
                ExpiresAt = DateTime.UtcNow.Add(DefaultTtl),
                UsedAt = null,
                MachineId = machineId,
                CreatedAt = DateTime.UtcNow
            };

            _db.EnrollmentTokens.Add(entity);
            await _db.SaveChangesAsync(cancellationToken);

            return (plain, entity);
        }

        throw new InvalidOperationException("Unable to generate a unique enrollment token.");
    }

    public Task<EnrollmentToken?> FindValidAsync(string tokenHash, CancellationToken cancellationToken = default)
    {
        return _db.EnrollmentTokens
            .Where(t => t.TokenHash == tokenHash)
            .Where(t => t.UsedAt == null)
            .Where(t => t.ExpiresAt > DateTime.UtcNow)
            .FirstOrDefaultAsync(cancellationToken);
    }
}
