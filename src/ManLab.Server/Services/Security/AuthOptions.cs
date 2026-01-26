namespace ManLab.Server.Services.Security;

public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>
    /// JWT issuer.
    /// </summary>
    public string Issuer { get; set; } = "manlab";

    /// <summary>
    /// JWT audience.
    /// </summary>
    public string Audience { get; set; } = "manlab.dashboard";

    /// <summary>
    /// Symmetric signing key (minimum 32 bytes recommended).
    /// </summary>
    public string JwtSigningKey { get; set; } = string.Empty;

    /// <summary>
    /// Access token lifetime in minutes.
    /// </summary>
    public int AccessTokenMinutes { get; set; } = 60;
}
