using ManLab.Agent.Commands;
using ManLab.Agent.Configuration;
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

    [Fact]
    public async Task ScriptRun_WhenEnabled_Rejects_MissingScriptIdAndContent()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            },
            config: new AgentConfiguration { EnableScripts = true });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "script.run", "{}");

        var failure = Assert.Single(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("scriptid", failure.Logs ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ScriptRun_WhenEnabled_Rejects_MissingShell_ForInlineContent()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            },
            config: new AgentConfiguration { EnableScripts = true });

        await dispatcher.DispatchAsync(Guid.NewGuid(), "script.run", "{\"content\":\"echo hi\"}");

        var failure = Assert.Single(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("shell", failure.Logs ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ScriptRun_WhenEnabled_Rejects_UnsupportedShell()
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            },
            config: new AgentConfiguration { EnableScripts = true });

        // Use a fake shell name. This avoids invoking any real system process.
        await dispatcher.DispatchAsync(Guid.NewGuid(), "script.run", "{\"shell\":\"DefinitelyNotAShell\",\"content\":\"hi\"}");

        var failure = Assert.Single(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("unsupported", failure.Logs ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }
}
