using ManLab.Server.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class InstallerScriptsControllerTests
{
    [Fact]
    public void GetInstallSh_NormalizesToLf_NoCarriageReturns()
    {
        var controller = new InstallerScriptsController(NullLogger<InstallerScriptsController>.Instance);

        var result = controller.GetInstallSh();
        var content = Assert.IsType<ContentResult>(result);

        Assert.NotNull(content.Content);
        Assert.DoesNotContain("\r", content.Content);
        Assert.Contains("#!/usr/bin/env bash\n", content.Content);
        Assert.Contains("set -euo pipefail\n", content.Content);

        // End-to-end config: the quick installer should fetch the server-generated appsettings template
        // so Web-configured agent defaults apply during onboarding installs.
        Assert.Contains("/api/binaries/agent/", content.Content);
        Assert.Contains("appsettings.json", content.Content);
    }
}
