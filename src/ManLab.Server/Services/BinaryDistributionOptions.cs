namespace ManLab.Server.Services;

public sealed class BinaryDistributionOptions
{
    public const string SectionName = "BinaryDistribution";

    /// <summary>
    /// Root folder containing locally staged artifacts.
    /// If empty, defaults to {ContentRoot}/Distribution.
    /// </summary>
    public string? RootPath { get; init; }

    /// <summary>
    /// Default distribution channel to use when none is specified (e.g., "stable").
    /// </summary>
    public string DefaultChannel { get; init; } = "stable";

    /// <summary>
    /// When true, fall back to the legacy layout {DistributionRoot}/agent/{rid}/... if the
    /// channelled layout {DistributionRoot}/agent/{channel}/{rid}/... does not exist.
    /// </summary>
    public bool EnableLegacyFallback { get; init; } = true;
}
