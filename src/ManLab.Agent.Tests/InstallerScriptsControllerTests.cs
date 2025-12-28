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
    }
}
