using System.Net;
using System.Net.NetworkInformation;
using ManLab.Server.Services.Network;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Xunit;

namespace ManLab.Server.Tests.Network;

public class NetworkScannerServiceTests
{
    private readonly Mock<ILogger<NetworkScannerService>> _loggerMock;
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock;
    private readonly Mock<IOptions<PublicIpOptions>> _optionsMock;
    private readonly Mock<IArpService> _arpServiceMock;
    private readonly Mock<IOuiDatabase> _ouiDatabaseMock;
    private readonly Mock<IIpGeolocationService> _geolocationServiceMock;
    private readonly NetworkScannerService _service;

    public NetworkScannerServiceTests()
    {
        _loggerMock = new Mock<ILogger<NetworkScannerService>>();
        _httpClientFactoryMock = new Mock<IHttpClientFactory>();
        _optionsMock = new Mock<IOptions<PublicIpOptions>>();
        _arpServiceMock = new Mock<IArpService>();
        _ouiDatabaseMock = new Mock<IOuiDatabase>();
        _geolocationServiceMock = new Mock<IIpGeolocationService>();

        _optionsMock.Setup(x => x.Value).Returns(new PublicIpOptions());
        var httpClient = new HttpClient(); // Real HTTP client for default tests
        _httpClientFactoryMock.Setup(x => x.CreateClient(It.IsAny<string>())).Returns(httpClient);

        _service = new NetworkScannerService(
            _loggerMock.Object,
            _httpClientFactoryMock.Object,
            _optionsMock.Object,
            _arpServiceMock.Object,
            _ouiDatabaseMock.Object,
            _geolocationServiceMock.Object
        );
    }

    [Fact]
    public async Task PingAsync_WithValidHost_ReturnsResult()
    {
        var result = await _service.PingAsync("127.0.0.1");
        Assert.NotNull(result);
        Assert.Equal("127.0.0.1", result.Address);
    }

    [Fact]
    public async Task PingAsync_WithEmptyHost_ThrowsArgumentException()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _service.PingAsync(""));
    }

    [Fact]
    public async Task DnsLookupAsync_WithValidQuery_ReturnsResults()
    {
        var result = await _service.DnsLookupAsync("localhost");
        Assert.NotNull(result);
        Assert.Equal("localhost", result.Query);
    }

    [Fact]
    public async Task ScanPortsAsync_WithLocalhost_FindsSomethingOrCompletes()
    {
        var result = await _service.ScanPortsAsync("127.0.0.1", new[] { 80, 443 }, timeout: 500); // 80/443 might be closed but shouldn't crash
        Assert.NotNull(result);
        Assert.Equal("127.0.0.1", result.Host);
        Assert.Equal(2, result.ScannedPorts);
    }

    [Fact]
    public async Task GetDeviceInfoAsync_WithLocalhost_ReturnsInfo()
    {
        var result = await _service.GetDeviceInfoAsync("127.0.0.1");
        Assert.NotNull(result);
        Assert.Equal("127.0.0.1", result.IpAddress);
    }

    [Fact]
    public async Task ScanSubnetAsync_WithSmallCidr_ReturnsResults()
    {
        var hosts = new List<DiscoveredHost>();
        await foreach (var host in _service.ScanSubnetAsync("127.0.0.1/32", timeout: 500))
        {
            hosts.Add(host);
        }
        Assert.NotNull(hosts);
        // Expect at least 0 results without error
    }

    [Fact]
    public async Task TraceRouteAsync_WithLocalhost_ReturnsResult()
    {
        var result = await _service.TraceRouteAsync("127.0.0.1", maxHops: 5, timeout: 500);
        Assert.NotNull(result);
        Assert.Equal("127.0.0.1", result.Hostname);
        Assert.NotEmpty(result.Hops);
    }

    [Fact]
    public async Task DnsPropagationCheckAsync_WithValidQuery_ReturnsResult()
    {
        var result = await _service.DnsPropagationCheckAsync(
            "google.com",
            new[] { "8.8.8.8" },
            new[] { DnsRecordType.A }
        );
        Assert.NotNull(result);
        Assert.Equal("google.com", result.Query);
        Assert.NotNull(result.Servers);
    }

    [Fact]
    public void ParseCidr_WithValidCidr_ReturnsCorrectRange()
    {
        // /30 -> 4 addresses. Implementation skips network & broadcast for >= /24.
        // So expected count is 2 (e.g., .1 and .2)
        var result = _service.ParseCidr("192.168.1.0/30").ToList();

        Assert.Equal(2, result.Count);
        Assert.Contains(result, ip => ip.ToString() == "192.168.1.1");
        Assert.Contains(result, ip => ip.ToString() == "192.168.1.2");
    }



    [Fact]
    public async Task GetPublicIpAsync_ReturnsIp_WhenHttpClientSucceeds()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>();
        var response = new HttpResponseMessage
        {
            StatusCode = HttpStatusCode.OK,
            Content = new StringContent("{\"ip\": \"203.0.113.1\"}")
        };

        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>()
            )
            .ReturnsAsync(response);

        var httpClient = new HttpClient(handlerMock.Object);
        _httpClientFactoryMock.Setup(x => x.CreateClient(It.IsAny<string>())).Returns(httpClient);

        // Re-create service to use the new mock
        var service = new NetworkScannerService(
            _loggerMock.Object,
            _httpClientFactoryMock.Object,
            _optionsMock.Object,
            _arpServiceMock.Object,
            _ouiDatabaseMock.Object,
            _geolocationServiceMock.Object
        );

        // Act
        var result = await service.GetPublicIpAsync();

        // Assert
        Assert.NotNull(result);
        Assert.Equal("203.0.113.1", result.Ipv4);
    }
}
