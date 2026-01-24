namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for SNMP operations.
/// </summary>
public interface ISnmpService
{
    Task<IReadOnlyList<SnmpValue>> GetAsync(SnmpGetRequest request, CancellationToken ct);

    Task<IReadOnlyList<SnmpValue>> WalkAsync(SnmpWalkRequest request, CancellationToken ct);

    Task<SnmpTableResult> TableAsync(SnmpTableRequest request, CancellationToken ct);
}