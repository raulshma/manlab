using System.Text;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services.Audit;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using NATS.Client.Core;
using Xunit;
using ManLab.Shared.Dtos;

namespace ManLab.Agent.Tests;

public sealed class AuditLoggingTests
{
    [Fact]
    public void AuditLogService_TryEnqueue_WhenDisabled_DropsEvent()
    {
        var options = new TestOptionsMonitor<AuditOptions>(new AuditOptions { Enabled = false });
        var natsMock = new Mock<INatsConnection>();
        var queue = new AuditLogQueue(natsMock.Object, NullLogger<AuditLogQueue>.Instance);
        var audit = new AuditLogService(NullLogger<AuditLogService>.Instance, queue, options);

        var ok = audit.TryEnqueue(new AuditEvent { EventName = "x", Kind = "audit" });

        Assert.False(ok);
        natsMock.Verify(x => x.PublishAsync(
            AuditLogQueue.Subject,
            It.IsAny<AuditEventDto>(),
            It.IsAny<NatsHeaders?>(),
            It.IsAny<string?>(),
            It.IsAny<INatsSerialize<AuditEventDto>?>(),
            It.IsAny<NatsPubOpts?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public void AuditLogService_Truncates_Oversize_DataJson()
    {
        var options = new TestOptionsMonitor<AuditOptions>(new AuditOptions
        {
            Enabled = true,
            MaxDataJsonBytesUtf8 = 128
        });

        var natsMock = new Mock<INatsConnection>();
        natsMock.Setup(x => x.PublishAsync(
            AuditLogQueue.Subject,
            It.IsAny<AuditEventDto>(),
            It.IsAny<NatsHeaders?>(),
            It.IsAny<string?>(),
            It.IsAny<INatsSerialize<AuditEventDto>?>(),
            It.IsAny<NatsPubOpts?>(),
            It.IsAny<CancellationToken>()))
            .Returns(ValueTask.CompletedTask);

        var queue = new AuditLogQueue(natsMock.Object, NullLogger<AuditLogQueue>.Instance);
        var audit = new AuditLogService(NullLogger<AuditLogService>.Instance, queue, options);

        var big = "{\"data\":\"" + new string('a', 1000) + "\"}";
        Assert.True(Encoding.UTF8.GetByteCount(big) > options.CurrentValue.MaxDataJsonBytesUtf8);

        var ok = audit.TryEnqueue(new AuditEvent
        {
            Kind = "activity",
            EventName = "test",
            DataJson = big
        });

        Assert.True(ok);

        
        // AuditLogService uses fire-and-forget Task.Run, so we need to wait for the background task to complete.
        // We'll retry verification for up to 1 second.
        var deadline = DateTime.UtcNow.AddSeconds(1);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                natsMock.Verify(x => x.PublishAsync(
                    AuditLogQueue.Subject,
                    It.Is<AuditEventDto>(e => e.DataJson == "{\"_truncated\":true}"),
                    It.IsAny<NatsHeaders?>(),
                    It.IsAny<string?>(),
                    It.IsAny<INatsSerialize<AuditEventDto>?>(),
                    It.IsAny<NatsPubOpts?>(),
                    It.IsAny<CancellationToken>()), Times.Once);
                return; // verification passed
            }
            catch (MockException)
            {
                Thread.Sleep(50);
            }
        }
        
        // Final attempt that will throw if still failing
        natsMock.Verify(x => x.PublishAsync(
            AuditLogQueue.Subject,
            It.Is<AuditEventDto>(e => e.DataJson == "{\"_truncated\":true}"),
            It.IsAny<NatsHeaders?>(),
            It.IsAny<string?>(),
            It.IsAny<INatsSerialize<AuditEventDto>?>(),
            It.IsAny<NatsPubOpts?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AuditHttpMiddleware_Logs_Mutating_Request_Completion()
    {
        var options = new TestOptionsMonitor<AuditOptions>(new AuditOptions { Enabled = true });
        var sink = new CapturingAuditLog();

        var middleware = new AuditHttpMiddleware(async ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status204NoContent;
            await ctx.Response.WriteAsync(string.Empty);
        });

        var ctx = new DefaultHttpContext();
        ctx.Request.Method = HttpMethods.Post;
        ctx.Request.Path = "/api/devices/123/commands";
        ctx.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(ctx, sink, options);

        Assert.Contains(sink.Events, e => e.EventName == "http.request.completed" && e.HttpStatusCode == 204);
    }

    private sealed class CapturingAuditLog : IAuditLog
    {
        public List<AuditEvent> Events { get; } = new();

        public bool TryEnqueue(AuditEvent evt)
        {
            Events.Add(evt);
            return true;
        }
    }

    private sealed class TestOptionsMonitor<T>(T current) : IOptionsMonitor<T>
        where T : class
    {
        public T CurrentValue => current;
        public T Get(string? name) => current;
        public IDisposable? OnChange(Action<T, string?> listener) => NullDisposable.Instance;

        private sealed class NullDisposable : IDisposable
        {
            public static readonly NullDisposable Instance = new();
            public void Dispose() { }
        }
    }
}
