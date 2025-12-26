namespace ManLab.Agent.Configuration;

/// <summary>
/// Configuration settings for the ManLab agent.
/// </summary>
public class AgentConfiguration
{
    /// <summary>
    /// The URL of the ManLab server hub (e.g., "http://localhost:5000/hubs/agent").
    /// </summary>
    public string ServerUrl { get; set; } = "http://localhost:5000/hubs/agent";

    /// <summary>
    /// Authentication token for authenticating with the server.
    /// </summary>
    public string? AuthToken { get; set; }

    /// <summary>
    /// Interval in seconds between telemetry heartbeats. Default is 5 seconds.
    /// </summary>
    public int HeartbeatIntervalSeconds { get; set; } = 5;

    /// <summary>
    /// Maximum reconnection delay in seconds. Default is 60 seconds.
    /// </summary>
    public int MaxReconnectDelaySeconds { get; set; } = 60;
}
