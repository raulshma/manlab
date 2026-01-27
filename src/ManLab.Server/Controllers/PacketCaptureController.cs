using ManLab.Server.Services.Network;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/network/packet-capture")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.PacketCapture)]
public sealed class PacketCaptureController : ControllerBase
{
    private readonly IPacketCaptureService _service;

    public PacketCaptureController(IPacketCaptureService service)
    {
        _service = service;
    }

    [HttpGet("status")]
    public ActionResult<PacketCaptureStatus> GetStatus()
    {
        return Ok(_service.GetStatus());
    }

    [HttpGet("devices")]
    public ActionResult<IReadOnlyList<PacketCaptureDeviceInfo>> GetDevices()
    {
        return Ok(_service.GetDevices());
    }

    [HttpGet("recent")]
    public ActionResult<IReadOnlyList<PacketCaptureRecord>> GetRecent([FromQuery] int count = 200)
    {
        return Ok(_service.GetRecent(count));
    }

    [HttpPost("start")]
    public async Task<ActionResult<PacketCaptureStatus>> Start([FromBody] PacketCaptureStartRequest request, CancellationToken ct)
    {
        var status = await _service.StartCaptureAsync(request, ct).ConfigureAwait(false);
        if (!status.Enabled)
        {
            return StatusCode(503, status);
        }

        return Ok(status);
    }

    [HttpPost("stop")]
    public async Task<ActionResult<PacketCaptureStatus>> Stop(CancellationToken ct)
    {
        var status = await _service.StopCaptureAsync(ct).ConfigureAwait(false);
        return Ok(status);
    }

    [HttpPost("clear")]
    public ActionResult Clear()
    {
        _service.Clear();
        return NoContent();
    }
}
