using ManLab.Server.Data.Entities;

namespace ManLab.Server.Services;

public interface INotificationService
{
    Task NotifyNodeOfflineAsync(Node node, CancellationToken cancellationToken = default);
}
