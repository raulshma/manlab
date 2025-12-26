using ManLab.Agent.Commands;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ManLab.Agent.Tests;

public class CommandDispatcherValidationTests
{
    [Fact]
    public async Task DockerRestart_Rejects_NonJsonPayload()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "docker.restart", "not-json");

        Assert.Contains(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task DockerRestart_Rejects_MissingContainerId()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "docker.restart", "{}");

        Assert.Contains(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task SystemUpdate_Rejects_NonJsonPayload_WhenProvided()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "system.update", "definitely-not-json");

        Assert.Contains(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
    }
}
