using System.Text;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services.Audit;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class AuditLoggingTests
{
    [Fact]
    public void AuditLogService_TryEnqueue_WhenDisabled_DropsEvent()
    {
        var options = new TestOptionsMonitor<AuditOptions>(new AuditOptions { Enabled = false });
        var queue = new AuditLogQueue(options);
        var audit = new AuditLogService(NullLogger<AuditLogService>.Instance, queue, options);

        var ok = audit.TryEnqueue(new AuditEvent { EventName = "x", Kind = "audit" });

        Assert.False(ok);
        Assert.False(queue.Reader.TryRead(out _));
    }

    [Fact]
    public void AuditLogService_Truncates_Oversize_DataJson()
    {
        var options = new TestOptionsMonitor<AuditOptions>(new AuditOptions
        {
            Enabled = true,
            QueueCapacity = 100,
            MaxDataJsonBytesUtf8 = 128
        });

        var queue = new AuditLogQueue(options);
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
        Assert.True(queue.Reader.TryRead(out var evt));
        Assert.Equal("{\"_truncated\":true}", evt.DataJson);
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
