using ManLab.Agent.Commands;
using ManLab.Agent.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ManLab.Agent.Tests;

public class RemoteToolsDefaultDenyTests
{
    [Theory]
    [InlineData("log.read")]
    [InlineData("log.tail")]
    [InlineData("script.run")]
    [InlineData("terminal.open")]
    [InlineData("terminal.close")]
    [InlineData("terminal.input")]
    public async Task RemoteTools_AreDenied_ByDefault(string type)
    {
        var updates = new List<(string Status, string? Logs)>();

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            (id, status, logs) =>
            {
                updates.Add((status, logs));
                return Task.CompletedTask;
            },
            shutdownCallback: null,
            config: new AgentConfiguration()); // defaults are all disabled

        await dispatcher.DispatchAsync(Guid.NewGuid(), type, "{}");

        var failure = Assert.Single(updates, u => u.Status.Equals("Failed", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("disabled", failure.Logs ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }
}
