using System.Threading.Channels;
using ManLab.Server.Data.Entities;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Audit;

public sealed class AuditLogQueue
{
    private readonly Channel<AuditEvent> _channel;

    public AuditLogQueue(IOptionsMonitor<AuditOptions> options)
    {
        var capacity = Math.Max(100, options.CurrentValue.QueueCapacity);

        // Bounded channel protects the process under DB outages / backpressure.
        _channel = Channel.CreateBounded<AuditEvent>(new BoundedChannelOptions(capacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropWrite
        });
    }

    public ChannelWriter<AuditEvent> Writer => _channel.Writer;
    public ChannelReader<AuditEvent> Reader => _channel.Reader;
}
