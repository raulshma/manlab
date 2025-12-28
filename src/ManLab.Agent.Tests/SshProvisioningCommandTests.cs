using System.Text.RegularExpressions;
using ManLab.Server.Services.Ssh;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class SshProvisioningCommandTests
{
    [Fact]
    public void BuildLinuxInstallCommand_ContainsRequiredParts_AndAvoidsEmptyRedirects()
    {
        var cmd = SshProvisioningService.BuildLinuxInstallCommand(
            server: "http://192.168.1.5:5247",
            url: "http://192.168.1.5:5247/install.sh",
            enrollmentToken: "token-value",
            sudoPrefix: "sudo -n ",
            forceArg: " --force",
            extraInstallerArgs: " --prefer-github --github-release-base-url 'https://github.com/acme/manlab/releases/download' --github-version 'v1.2.3'");

        Assert.Contains("bash -lc", cmd);
        Assert.Contains("mktemp /tmp/manlab-install.XXXXXX", cmd);
        Assert.Contains("trap", cmd);
        Assert.Contains("rm -f", cmd);
        Assert.Contains("$TMP", cmd);
        Assert.Contains("EXIT", cmd);

        // Download to file (no shell redirection that could become "> ;").
        Assert.Contains("curl -fsSL", cmd);
        Assert.Contains("wget", cmd);

        Assert.Matches(new Regex(@"-o\s+.*\$TMP", RegexOptions.IgnoreCase), cmd);
        Assert.Matches(new Regex(@"-O\s+.*\$TMP", RegexOptions.IgnoreCase), cmd);

        Assert.Matches(new Regex(@"chmod\s+\+x\s+.*\$TMP", RegexOptions.IgnoreCase), cmd);
        Assert.Contains("sudo -n", cmd);
        Assert.Contains("bash", cmd);
        Assert.Contains("$TMP", cmd);
        Assert.Contains("--server", cmd);
        Assert.Contains("--token", cmd);
        Assert.Contains("--prefer-github", cmd);
        Assert.Contains("--github-release-base-url", cmd);
        Assert.Contains("--github-version", cmd);

        Assert.DoesNotContain("> ;", cmd);
        Assert.DoesNotContain("chmod +x ;", cmd);
        Assert.DoesNotContain("bash  --server", cmd);
    }

    [Fact]
    public void BuildLinuxUninstallCommand_ContainsRequiredParts()
    {
        var cmd = SshProvisioningService.BuildLinuxUninstallCommand(
            url: "http://example.com/install.sh",
            sudoPrefix: string.Empty);

        Assert.Contains("--uninstall", cmd);
        Assert.Contains("mktemp /tmp/manlab-install.XXXXXX", cmd);

        // Quick sanity: ensure we still download to a temp file.
        Assert.Matches(new Regex("(curl .* -o|wget .* -O)", RegexOptions.IgnoreCase), cmd);
    }
}
