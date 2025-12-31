using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class StructuredOutputAccumulationTests
{
    [Fact]
    public void AccumulateStructuredOutput_FirstChunk_Overwrites()
    {
        var existing = "previous";
        var chunk = "{\"contentBase64\":\"AAAA\"";

        var combined = AgentHub.AccumulateStructuredOutput(existing, chunk);

        Assert.Equal(chunk, combined);
    }

    [Fact]
    public void AccumulateStructuredOutput_ContinuationChunk_AppendsWithoutNewlines()
    {
        var first = "{\"contentBase64\":\"AAAA\"";
        var second = ",\"bytesRead\":4}";

        var combined = AgentHub.AccumulateStructuredOutput(first, second);

        Assert.Equal(first + second, combined);
        Assert.DoesNotContain("\n", combined);
    }

    [Theory]
    [InlineData(true, CommandStatus.InProgress, true)]
    [InlineData(true, CommandStatus.Success, true)]
    [InlineData(true, CommandStatus.Failed, true)]
    [InlineData(true, CommandStatus.Queued, false)]
    [InlineData(false, CommandStatus.InProgress, false)]
    public void ShouldTreatAsStructuredFileBrowserOutput_IsCorrect(bool isStructuredCommand, CommandStatus status, bool expected)
    {
        Assert.Equal(expected, AgentHub.ShouldTreatAsStructuredFileBrowserOutput(isStructuredCommand, status));
    }
}
