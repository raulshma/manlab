namespace ManLab.Server.Services.Network;

public sealed record PublicIpOptions
{
    public const string SectionName = "PublicIp";

    public int TimeoutSeconds { get; init; } = 5;
}
