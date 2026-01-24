using ManLab.Server.Services.Network;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/network/syslog")]
public sealed class SyslogController : ControllerBase
{
    private readonly ISyslogMessageStore _store;

    public SyslogController(ISyslogMessageStore store)
    {
        _store = store;
    }

    [HttpGet("status")]
    public ActionResult<SyslogStatus> GetStatus()
    {
        return Ok(_store.GetStatus());
    }

    [HttpGet("recent")]
    public ActionResult<IReadOnlyList<SyslogMessage>> GetRecent([FromQuery] int count = 200)
    {
        return Ok(_store.GetRecent(count));
    }

    [HttpPost("clear")]
    public ActionResult Clear()
    {
        _store.Clear();
        return NoContent();
    }
}
