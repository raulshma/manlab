using ManLab.Agent.Commands;
using Microsoft.Extensions.Logging.Abstractions;
using System.Runtime.InteropServices;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class ServiceCommandValidationTests
{
    [Fact]
    public async Task ServiceStatus_Accepts_ServiceName_Field()
    {
        // This test is OS-agnostic because it uses a linux-style service name that should be valid everywhere.
        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            updateStatusCallback: (_, _, _) => Task.CompletedTask,
            sendServiceSnapshots: _ => Task.CompletedTask);

        // NOTE: We expect the command to fail on non-Linux/non-Windows platforms.
        // The point of this test is that payload parsing doesn't reject serviceName.
        var ex = await Record.ExceptionAsync(() => dispatcher.DispatchAsync(
            Guid.NewGuid(),
            "service.status",
            "{\"serviceName\":\"nginx\"}"));

        // If we got here, payload parsing succeeded. Execution may fail depending on OS.
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux) || RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // On CI we may not actually have nginx/scm service; so we only assert we didn't get an ArgumentException.
            Assert.False(ex is ArgumentException, ex?.ToString());
        }
        else
        {
            Assert.True(ex is null || ex is NotSupportedException);
        }
    }

    [Fact]
    public async Task ServiceStatus_Windows_Allows_DisplayName_With_Spaces()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        var dispatcher = new CommandDispatcher(
            NullLoggerFactory.Instance,
            updateStatusCallback: (_, _, _) => Task.CompletedTask,
            sendServiceSnapshots: _ => Task.CompletedTask);

        var ex = await Record.ExceptionAsync(() => dispatcher.DispatchAsync(
            Guid.NewGuid(),
            "service.status",
            "{\"service\":\"Print Spooler\"}"));

        // We don't assert success of execution (service might not exist on the test machine),
        // just that parsing/validation doesn't reject spaces on Windows.
        Assert.False(ex is ArgumentException, ex?.ToString());
    }
}
