namespace ManLab.Server.Services;

public sealed class BinaryDistributionOptions
{
    public const string SectionName = "BinaryDistribution";

    /// <summary>
    /// Root folder containing locally staged artifacts.
    /// If empty, defaults to {ContentRoot}/Distribution.
    /// </summary>
    public string? RootPath { get; init; }
}
