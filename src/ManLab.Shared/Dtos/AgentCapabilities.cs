namespace ManLab.Shared.Dtos;

/// <summary>
/// A concrete, AOT-friendly capabilities payload that can be serialized using the
/// System.Text.Json source-generated context.
///
/// The server stores this as JSON (jsonb) without interpreting fields, so this schema
/// can evolve safely as the agent grows new features.
/// </summary>
public sealed record AgentCapabilities
{
    /// <summary>
    /// Tooling / binaries detected on the host.
    /// </summary>
    public AgentToolCapabilities Tools { get; init; } = new();

    /// <summary>
    /// Feature flags as configured on the agent.
    /// </summary>
    public AgentFeatureCapabilities Features { get; init; } = new();

    /// <summary>
    /// Optional additional notes (for debugging / support).
    /// Keep this short to avoid inflating registration payloads.
    /// </summary>
    public string? Notes { get; init; }
}

public sealed record AgentToolCapabilities
{
    public bool Smartctl { get; init; }
    public bool NvidiaSmi { get; init; }
    public bool Upsc { get; init; }
    public bool Apcaccess { get; init; }
}

public sealed record AgentFeatureCapabilities
{
    /// <summary>
    /// Remote log viewer (log.read/log.tail).
    /// </summary>
    public bool LogViewer { get; init; }

    /// <summary>
    /// Remote script execution (script.run).
    /// </summary>
    public bool Scripts { get; init; }

    /// <summary>
    /// Remote terminal (terminal.*).
    /// </summary>
    public bool Terminal { get; init; }
}
