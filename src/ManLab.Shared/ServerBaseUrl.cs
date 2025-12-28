namespace ManLab.Shared;

/// <summary>
/// Helpers for working with the "server base URL" (origin) used by installers and onboarding.
/// 
/// The agent installers expect an origin (scheme://host[:port]) and will append fixed paths
/// like <c>/install.sh</c>, <c>/install.ps1</c>, and <c>/api/binaries</c>.
/// </summary>
public static class ServerBaseUrl
{
    /// <summary>
    /// Normalizes a user-provided URL to an origin-only URL (scheme://host[:port]).
    /// Returns false if the input is not an absolute URL.
    /// </summary>
    public static bool TryNormalizeInstallerOrigin(
        string? input,
        out Uri? origin,
        out string? error,
        out bool changed)
    {
        origin = null;
        error = null;
        changed = false;

        if (string.IsNullOrWhiteSpace(input))
        {
            error = "serverBaseUrl is required.";
            return false;
        }

        if (!Uri.TryCreate(input.Trim(), UriKind.Absolute, out var raw))
        {
            error = "Invalid serverBaseUrl (must be an absolute URL).";
            return false;
        }

        // Guard against values that parse as absolute URIs but are not web origins
        // (e.g. "example.com:5247" becomes scheme="example.com").
        if (!string.Equals(raw.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(raw.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            error = "Invalid serverBaseUrl (must start with http:// or https://).";
            return false;
        }

        var normalized = new UriBuilder(raw)
        {
            Path = string.Empty,
            Query = string.Empty,
            Fragment = string.Empty
        }.Uri;

        // Consider it changed if anything other than a trailing slash differs.
        var rawComparable = raw.ToString().TrimEnd('/');
        var normComparable = normalized.ToString().TrimEnd('/');
        changed = !string.Equals(rawComparable, normComparable, StringComparison.Ordinal);

        origin = normalized;
        return true;
    }
}
