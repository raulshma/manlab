using ManLab.Server.Data;
using ManLab.Shared.Dtos;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Provides authorization checks for remote tools based on node capabilities.
/// Implements default-deny: tools are disabled unless explicitly enabled by the agent configuration.
/// </summary>
public sealed class RemoteToolsAuthorizationService
{
    private readonly DataContext _db;
    private readonly ILogger<RemoteToolsAuthorizationService> _logger;

    public RemoteToolsAuthorizationService(DataContext db, ILogger<RemoteToolsAuthorizationService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Checks if the log viewer feature is enabled for the specified node.
    /// </summary>
    /// <param name="nodeId">The node ID to check.</param>
    /// <returns>A tuple indicating whether access is allowed and an error message if not.</returns>
    public async Task<(bool Allowed, string? Error)> AuthorizeLogViewerAsync(Guid nodeId)
    {
        return await CheckFeatureEnabledAsync(nodeId, "log viewer", caps => caps?.Features?.LogViewer ?? false);
    }

    /// <summary>
    /// Checks if the scripts feature is enabled for the specified node.
    /// </summary>
    /// <param name="nodeId">The node ID to check.</param>
    /// <returns>A tuple indicating whether access is allowed and an error message if not.</returns>
    public async Task<(bool Allowed, string? Error)> AuthorizeScriptsAsync(Guid nodeId)
    {
        return await CheckFeatureEnabledAsync(nodeId, "script execution", caps => caps?.Features?.Scripts ?? false);
    }

    /// <summary>
    /// Checks if the terminal feature is enabled for the specified node.
    /// </summary>
    /// <param name="nodeId">The node ID to check.</param>
    /// <returns>A tuple indicating whether access is allowed and an error message if not.</returns>
    public async Task<(bool Allowed, string? Error)> AuthorizeTerminalAsync(Guid nodeId)
    {
        return await CheckFeatureEnabledAsync(nodeId, "terminal", caps => caps?.Features?.Terminal ?? false);
    }

    private async Task<(bool Allowed, string? Error)> CheckFeatureEnabledAsync(
        Guid nodeId,
        string featureName,
        Func<AgentCapabilities?, bool> featureCheck)
    {
        var node = await _db.Nodes
            .AsNoTracking()
            .Select(n => new { n.Id, n.CapabilitiesJson })
            .FirstOrDefaultAsync(n => n.Id == nodeId);

        if (node is null)
        {
            return (false, "Node not found.");
        }

        // Default-deny: if capabilities are null or missing, the feature is disabled
        if (string.IsNullOrWhiteSpace(node.CapabilitiesJson))
        {
            _logger.LogDebug("Node {NodeId} has no capabilities reported. Denying {Feature} access.", nodeId, featureName);
            return (false, $"The {featureName} feature is not available on this node. The agent has not reported its capabilities.");
        }

        AgentCapabilities? caps = null;
        try
        {
            caps = JsonSerializer.Deserialize<AgentCapabilities>(node.CapabilitiesJson, ManLabJsonContext.Default.AgentCapabilities);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse capabilities JSON for node {NodeId}", nodeId);
            return (false, $"The {featureName} feature is not available on this node. Failed to parse agent capabilities.");
        }

        if (!featureCheck(caps))
        {
            _logger.LogDebug("Node {NodeId} has {Feature} disabled in agent configuration.", nodeId, featureName);
            return (false, $"The {featureName} feature is disabled on this node. Enable it in the agent configuration and restart the agent.");
        }

        return (true, null);
    }
}
