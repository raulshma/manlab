using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
public sealed class InstallerScriptsController : ControllerBase
{
    private readonly ILogger<InstallerScriptsController> _logger;

    public InstallerScriptsController(ILogger<InstallerScriptsController> logger)
    {
        _logger = logger;
    }

    [HttpGet("/install.sh")]
    public IActionResult GetInstallSh()
    {
        var content = ReadEmbeddedText("ManLab.Server.Resources.install.sh");
        return Content(content, "text/x-shellscript");
    }

    [HttpGet("/install.ps1")]
    public IActionResult GetInstallPs1()
    {
        var content = ReadEmbeddedText("ManLab.Server.Resources.install.ps1");
        // Some clients treat text/plain as safer defaults than a custom type.
        return Content(content, "text/plain");
    }

    private string ReadEmbeddedText(string resourceName)
    {
        var asm = Assembly.GetExecutingAssembly();
        using var stream = asm.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            _logger.LogError("Missing embedded resource: {ResourceName}", resourceName);
            throw new InvalidOperationException($"Missing embedded resource: {resourceName}");
        }

        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
