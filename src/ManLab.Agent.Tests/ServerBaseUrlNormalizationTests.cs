using ManLab.Shared;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class ServerBaseUrlNormalizationTests
{
    [Theory]
    [InlineData("http://example.com:5247", "http://example.com:5247/")]
    [InlineData("http://example.com:5247/", "http://example.com:5247/")]
    [InlineData("http://example.com:5247/api", "http://example.com:5247/")]
    [InlineData("http://example.com:5247/api/", "http://example.com:5247/")]
    [InlineData("http://example.com:5247/hubs/agent", "http://example.com:5247/")]
    [InlineData("http://example.com:5247/hubs/agent?x=1", "http://example.com:5247/")]
    [InlineData("https://example.com:8080/some/path", "https://example.com:8080/")]
    public void TryNormalizeInstallerOrigin_StripsPathAndQuery(string input, string expected)
    {
        var ok = ServerBaseUrl.TryNormalizeInstallerOrigin(input, out var origin, out var error, out var changed);

        Assert.True(ok);
        Assert.Null(error);
        Assert.NotNull(origin);
        Assert.Equal(expected, origin!.ToString());

        // If there's a path or query, we expect it to have changed.
        if (input.Contains("/api", StringComparison.OrdinalIgnoreCase)
            || input.Contains("/hubs/agent", StringComparison.OrdinalIgnoreCase)
            || input.Contains("/some/path", StringComparison.OrdinalIgnoreCase)
            || input.Contains('?', StringComparison.Ordinal))
        {
            Assert.True(changed);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("example.com:5247")]
    [InlineData("/api")]
    public void TryNormalizeInstallerOrigin_RejectsNonAbsoluteUrls(string? input)
    {
        var ok = ServerBaseUrl.TryNormalizeInstallerOrigin(input, out var origin, out var error, out _);

        Assert.False(ok);
        Assert.Null(origin);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }
}
