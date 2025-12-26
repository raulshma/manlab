using ManLab.Server.Data;
using ManLab.Server.Data.Entities;

namespace ManLab.Server.Services.Ssh;

public sealed class SshAuditService
{
    private readonly DataContext _db;

    public SshAuditService(DataContext db)
    {
        _db = db;
    }

    public async Task RecordAsync(SshAuditEvent evt, CancellationToken cancellationToken = default)
    {
        _db.Set<SshAuditEvent>().Add(evt);
        await _db.SaveChangesAsync(cancellationToken);
    }
}
