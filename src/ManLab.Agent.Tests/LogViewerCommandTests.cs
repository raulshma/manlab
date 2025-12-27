using System.Text;
using ManLab.Agent.Commands;
using ManLab.Agent.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ManLab.Agent.Tests;

public class LogViewerCommandTests
{
    [Fact]
    public async Task LogRead_ReadsTail_ByDefault_AndIsBounded()
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"manlab_logread_{Guid.NewGuid():N}.log");
        try
        {
            await File.WriteAllTextAsync(tmp, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");

            var updates = new List<(string Status, string? Logs)>();

            var dispatcher = new CommandDispatcher(
                NullLoggerFactory.Instance,
                (id, status, logs) =>
                {
                    updates.Add((status, logs));
                    return Task.CompletedTask;
                },
                config: new AgentConfiguration
                {
                    EnableLogViewer = true,
                    LogMaxBytes = 8,
                    LogMinSecondsBetweenRequests = 0
                });

            // No offsetBytes => tail. Requested maxBytes larger than agent cap => agent cap wins.
            var payload = $"{{\"path\":\"{tmp.Replace("\\", "\\\\")}\",\"maxBytes\":99999}}";
            await dispatcher.DispatchAsync(Guid.NewGuid(), "log.read", payload);

            var success = updates.Last(u => u.Status.Equals("Success", StringComparison.OrdinalIgnoreCase));
            Assert.NotNull(success.Logs);
            Assert.True(success.Logs!.Length <= 8);
            Assert.Equal("STUVWXYZ", success.Logs);
        }
        finally
        {
            try { File.Delete(tmp); } catch { }
        }
    }

    [Fact]
    public async Task LogRead_RequiresJsonObjectPayload()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            },
            config: new AgentConfiguration
            {
                EnableLogViewer = true,
                LogMinSecondsBetweenRequests = 0
            });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "log.read", "not-json");

        var failure = updates.Single(u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("valid JSON", failure.Logs ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LogTail_StreamsChunks_AndCompletes()
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"manlab_logtail_{Guid.NewGuid():N}.log");
        try
        {
            await File.WriteAllTextAsync(tmp, "hello\n");

            var updates = new List<(string Status, string? Logs)>();

            var dispatcher = new CommandDispatcher(
                NullLoggerFactory.Instance,
                (id, status, logs) =>
                {
                    updates.Add((status, logs));
                    return Task.CompletedTask;
                },
                config: new AgentConfiguration
                {
                    EnableLogViewer = true,
                    LogMaxBytes = 64 * 1024,
                    LogMinSecondsBetweenRequests = 0
                });

            var commandId = Guid.NewGuid();

            // Start tail in the background.
            var payload = $"{{\"path\":\"{tmp.Replace("\\", "\\\\")}\",\"maxBytes\":1024,\"durationSeconds\":1,\"pollMs\":50,\"chunkBytes\":128}}";
            var task = dispatcher.DispatchAsync(commandId, "log.tail", payload);

            // Append while tailing.
            await Task.Delay(100);
            await File.AppendAllTextAsync(tmp, "world\n", Encoding.UTF8);

            await task;

            // We should have at least one in-progress chunk and a final Success.
            Assert.Contains(updates, u => u.Status.Equals("InProgress", StringComparison.OrdinalIgnoreCase) && (u.Logs ?? string.Empty).Contains("hello"));
            Assert.Contains(updates, u => u.Status.Equals("InProgress", StringComparison.OrdinalIgnoreCase) && (u.Logs ?? string.Empty).Contains("world"));
            Assert.Contains(updates, u => u.Status.Equals("Success", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            try { File.Delete(tmp); } catch { }
        }
    }
}
