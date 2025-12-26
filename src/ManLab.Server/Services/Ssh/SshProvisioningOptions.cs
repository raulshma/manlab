namespace ManLab.Server.Services.Ssh;

public sealed class SshProvisioningOptions
{
    public const string SectionName = "SshProvisioning";

    /// <summary>
    /// When true, the server may accept a host key on first use (TOFU) after explicit user confirmation.
    /// When false, only allowlist verification is permitted.
    /// </summary>
    public bool AllowTrustOnFirstUse { get; set; } = true;

    /// <summary>
    /// Max SSH failures allowed before lockout.
    /// </summary>
    public int MaxFailuresBeforeLockout { get; set; } = 5;

    /// <summary>
    /// Lockout duration after repeated failures.
    /// </summary>
    public TimeSpan LockoutDuration { get; set; } = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Rolling window for counting failures.
    /// </summary>
    public TimeSpan FailureWindow { get; set; } = TimeSpan.FromMinutes(10);
}
