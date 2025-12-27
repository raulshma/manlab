using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Commands;
using ManLab.Shared.Dtos;
using Xunit;

namespace ManLab.Agent.Tests;

public class CommandModelAlignmentTests
{
    [Fact]
    public void CanonicalCommandTypes_AreUnique_AndLowercase()
    {
        Assert.NotEmpty(CommandTypes.All);

        // Unique
        Assert.Equal(CommandTypes.All.Count, CommandTypes.All.Distinct(StringComparer.Ordinal).Count());

        // Canonical formatting guardrail
        foreach (var t in CommandTypes.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(t));
            Assert.Equal(t, t.Trim());
            Assert.Equal(t, t.ToLowerInvariant());
            Assert.Contains('.', t);
        }
    }

    [Theory]
    [InlineData(CommandTypes.SystemUpdate, CommandType.Update)]
    [InlineData(CommandTypes.DockerRestart, CommandType.DockerRestart)]
    [InlineData(CommandTypes.DockerList, CommandType.DockerList)]
    [InlineData(CommandTypes.AgentShutdown, CommandType.Shutdown)]
    [InlineData(CommandTypes.AgentEnableTask, CommandType.EnableTask)]
    [InlineData(CommandTypes.AgentDisableTask, CommandType.DisableTask)]
    [InlineData(CommandTypes.AgentUninstall, CommandType.Uninstall)]
    [InlineData(CommandTypes.ShellExec, CommandType.Shell)]
    [InlineData(CommandTypes.ServiceStatus, CommandType.ServiceStatus)]
    [InlineData(CommandTypes.ServiceRestart, CommandType.ServiceRestart)]
    [InlineData(CommandTypes.SmartScan, CommandType.SmartScan)]
    [InlineData(CommandTypes.ScriptRun, CommandType.ScriptRun)]
    [InlineData(CommandTypes.LogRead, CommandType.LogRead)]
    [InlineData(CommandTypes.LogTail, CommandType.LogTail)]
    [InlineData(CommandTypes.TerminalOpen, CommandType.TerminalOpen)]
    [InlineData(CommandTypes.TerminalClose, CommandType.TerminalClose)]
    [InlineData(CommandTypes.TerminalInput, CommandType.TerminalInput)]
    public void Mapper_RoundTrips_ExternalToEnum(string external, CommandType expected)
    {
        Assert.True(CommandTypeMapper.TryParseExternal(external, out var parsed));
        Assert.Equal(expected, parsed);
        Assert.Equal(external, CommandTypeMapper.ToExternal(parsed));
    }

    [Theory]
    [InlineData("DockerList", CommandType.DockerList)]
    [InlineData("dockerlist", CommandType.DockerList)]
    [InlineData("Update", CommandType.Update)]
    [InlineData("DockerRestart", CommandType.DockerRestart)]
    public void Mapper_Accepts_LegacyEnumNames(string legacy, CommandType expected)
    {
        Assert.True(CommandTypeMapper.TryParseExternal(legacy, out var parsed));
        Assert.Equal(expected, parsed);
    }
}
