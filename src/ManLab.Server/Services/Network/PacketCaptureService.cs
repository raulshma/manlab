using ManLab.Server.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using PacketDotNet;
using SharpPcap;
using SharpPcap.LibPcap;
using System.Threading.Channels;

namespace ManLab.Server.Services.Network;

public sealed class PacketCaptureService : IPacketCaptureService, IHostedService
{
    private readonly IHubContext<NetworkHub> _hubContext;
    private readonly ILogger<PacketCaptureService> _logger;
    private readonly PacketCaptureOptions _options;
    private readonly Channel<PacketCaptureRecord> _packetChannel;

    private readonly Lock _gate = new();

    // Circular buffer for O(1) packet storage instead of O(n) List.RemoveRange
    // Initialized lazily based on MaxBufferedPackets option
    private CircularBuffer<PacketCaptureRecord>? _packets;

    private long _nextId;
    private long _broadcastSampleCounter;
    private string? _error;
    private bool _pcapUnavailable;
    private bool _pcapUnavailableLogged;
    private string? _pcapUnavailableReason;
    private string? _deviceName;
    private string? _filter;
    private bool _isCapturing;
    private ICaptureDevice? _device;
    private PacketArrivalEventHandler? _handler;
    private CancellationTokenSource? _broadcastCts;
    private Task? _broadcastLoop;

    public PacketCaptureService(
        IOptions<PacketCaptureOptions> options,
        IHubContext<NetworkHub> hubContext,
        ILogger<PacketCaptureService> logger)
    {
        _options = options.Value;
        _hubContext = hubContext;
        _logger = logger;

        // Channel for buffering packets before broadcasting to SignalR
        _packetChannel = Channel.CreateBounded<PacketCaptureRecord>(new BoundedChannelOptions(1000)
        {
            SingleReader = true,
            SingleWriter = false, // Multiple packets may arrive concurrently
            FullMode = BoundedChannelFullMode.DropWrite
        });
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return Task.CompletedTask;
        }

        EnsurePcapAvailable();

        _broadcastCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _broadcastLoop = Task.Run(() => BroadcastLoopAsync(_broadcastCts.Token), cancellationToken);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await StopCaptureAsync(cancellationToken).ConfigureAwait(false);

        if (_broadcastCts is not null)
        {
            _broadcastCts.Cancel();
            if (_broadcastLoop is not null)
            {
                try
                {
                    await _broadcastLoop.ConfigureAwait(false);
                }
                catch (OperationCanceledException) { }
            }
            _broadcastCts.Dispose();
            _broadcastCts = null;
            _broadcastLoop = null;
        }
    }

    public PacketCaptureStatus GetStatus()
    {
        lock (_gate)
        {
            return new PacketCaptureStatus
            {
                Enabled = _options.Enabled,
                PcapAvailable = !_pcapUnavailable,
                IsCapturing = _isCapturing,
                DeviceName = _deviceName,
                Filter = _filter,
                Error = _error,
                BufferedCount = _packets?.Count ?? 0,
                DroppedCount = _packets?.DroppedCount ?? 0
            };
        }
    }

    public IReadOnlyList<PacketCaptureDeviceInfo> GetDevices()
    {
        try
        {
            if (!_options.Enabled)
            {
                return [];
            }

            var devices = CaptureDeviceList.Instance;
            return devices
                .Select(device => new PacketCaptureDeviceInfo
                {
                    Name = device.Name ?? string.Empty,
                    Description = device.Description,
                    IsLoopback = device is LibPcapLiveDevice liveDevice && liveDevice.Loopback
                })
                .ToList();
        }
        catch (DllNotFoundException ex)
        {
            SetPcapUnavailable(ex);
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to enumerate packet capture devices");
            lock (_gate)
            {
                _error = ex.Message;
            }
            return [];
        }
    }

    public IReadOnlyList<PacketCaptureRecord> GetRecent(int count)
    {
        count = Math.Clamp(count, 1, 2000);
        lock (_gate)
        {
            if (_packets is null || _packets.Count == 0)
            {
                return [];
            }

            return _packets.GetRecent(count);
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _packets?.Reset();
        }
    }

    public async Task<PacketCaptureStatus> StartCaptureAsync(PacketCaptureStartRequest request, CancellationToken ct)
    {
        if (!_options.Enabled)
        {
            return GetStatus();
        }

        if (IsPcapUnavailable())
        {
            return GetStatus();
        }

        await StopCaptureAsync(ct).ConfigureAwait(false);

        try
        {
            var device = ResolveDevice(request.DeviceName);
            if (device is null)
            {
                lock (_gate)
                {
                    _error = "No capture device found";
                    _isCapturing = false;
                    _deviceName = null;
                }
                return GetStatus();
            }

            device.Open(new DeviceConfiguration
            {
                Snaplen = _options.SnapLength,
                Mode = _options.Promiscuous ? DeviceModes.Promiscuous : DeviceModes.None,
                ReadTimeout = 1000
            });
            if (!string.IsNullOrWhiteSpace(request.Filter))
            {
                device.Filter = request.Filter;
            }

            _handler = (sender, capture) => HandlePacket(capture);
            device.OnPacketArrival += _handler;
            device.StartCapture();

            lock (_gate)
            {
                _device = device;
                _deviceName = device.Name;
                _filter = request.Filter;
                _isCapturing = true;
                _error = null;
            }

            _logger.LogInformation("Packet capture started on {Device}", device.Name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start packet capture");
            lock (_gate)
            {
                _error = ex.Message;
                _isCapturing = false;
            }
        }

        return GetStatus();
    }

    public Task<PacketCaptureStatus> StopCaptureAsync(CancellationToken ct)
    {
        ICaptureDevice? device;
        PacketArrivalEventHandler? handler;

        lock (_gate)
        {
            device = _device;
            handler = _handler;
            _device = null;
            _handler = null;
            _isCapturing = false;
            _deviceName = null;
            _filter = null;
        }

        if (device is not null)
        {
            try
            {
                if (handler is not null)
                {
                    device.OnPacketArrival -= handler;
                }

                if (device.Started)
                {
                    device.StopCapture();
                }
                device.Close();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to stop packet capture cleanly");
                lock (_gate)
                {
                    _error = ex.Message;
                }
            }
        }

        return Task.FromResult(GetStatus());
    }

    private ICaptureDevice? ResolveDevice(string? deviceName)
    {
        try
        {
            var devices = CaptureDeviceList.Instance;
            if (devices.Count == 0)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(deviceName))
            {
                var match = devices.FirstOrDefault(d => string.Equals(d.Name, deviceName, StringComparison.OrdinalIgnoreCase))
                    ?? devices.FirstOrDefault(d => string.Equals(d.Description, deviceName, StringComparison.OrdinalIgnoreCase));

                if (match is not null)
                {
                    return match;
                }
            }

            return devices[0];
        }
        catch (DllNotFoundException ex)
        {
            SetPcapUnavailable(ex);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to resolve capture device");
            lock (_gate)
            {
                _error = ex.Message;
            }
            return null;
        }
    }

    private bool IsPcapUnavailable()
    {
        lock (_gate)
        {
            return _pcapUnavailable;
        }
    }

    private void SetPcapUnavailable(Exception ex)
    {
        lock (_gate)
        {
            _pcapUnavailable = true;
            _pcapUnavailableReason = "Packet capture unavailable. Install Npcap (WinPcap-compatible) and restart the server.";
            _error = _pcapUnavailableReason;
        }

        if (_pcapUnavailableLogged)
        {
            return;
        }

        _pcapUnavailableLogged = true;
        _logger.LogWarning(ex, "Packet capture unavailable: missing native capture library");
    }

    private void EnsurePcapAvailable()
    {
        if (_pcapUnavailable)
        {
            return;
        }

        try
        {
            _ = CaptureDeviceList.Instance;
        }
        catch (DllNotFoundException ex)
        {
            SetPcapUnavailable(ex);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to validate packet capture availability");
        }
    }

    private void HandlePacket(PacketCapture capture)
    {
        var record = BuildRecord(capture.GetPacket());
        if (record is null)
        {
            return;
        }

        lock (_gate)
        {
            // Lazy initialization of circular buffer with configured capacity
            _packets ??= new CircularBuffer<PacketCaptureRecord>(Math.Max(200, _options.MaxBufferedPackets));
            
            // O(1) add with automatic eviction of oldest items when full
            _packets.Add(record);
        }

        var sampleEvery = Math.Max(1, _options.BroadcastSampleEvery);
        if (sampleEvery == 1 || Interlocked.Increment(ref _broadcastSampleCounter) % sampleEvery == 0)
        {
            // Write directly to the broadcast channel
            _packetChannel.Writer.TryWrite(record);
        }
    }

    private async Task BroadcastLoopAsync(CancellationToken ct)
    {
        var batchSize = Math.Clamp(_options.BroadcastBatchSize, 1, 500);
        var intervalMs = Math.Clamp(_options.BroadcastIntervalMs, 25, 2000);

        var batch = new List<PacketCaptureRecord>(batchSize);
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(intervalMs));

        try
        {
            while (await timer.WaitForNextTickAsync(ct).ConfigureAwait(false))
            {
                while (batch.Count < batchSize && _packetChannel.Reader.TryRead(out var record))
                {
                    batch.Add(record);
                }

                if (batch.Count == 0)
                {
                    continue;
                }

                try
                {
                    await _hubContext.Clients
                        .Group(NetworkHub.PacketCaptureGroup)
                        .SendAsync("PacketCapturedBatch", batch, ct)
                        .ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogDebug(ex, "Failed to broadcast packet batch");
                }
                finally
                {
                    batch.Clear();
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    private PacketCaptureRecord? BuildRecord(RawCapture capture)
    {
        try
        {
            var packet = Packet.ParsePacket(capture.LinkLayerType, capture.Data);
            var ethernet = packet.Extract<EthernetPacket>();
            var ip = packet.Extract<IPPacket>();
            var tcp = packet.Extract<TcpPacket>();
            var udp = packet.Extract<UdpPacket>();
            var icmp = packet.Extract<IcmpV4Packet>();

            var protocol = ip?.Protocol.ToString();
            if (string.IsNullOrWhiteSpace(protocol) && tcp is not null)
            {
                protocol = "TCP";
            }
            else if (string.IsNullOrWhiteSpace(protocol) && udp is not null)
            {
                protocol = "UDP";
            }
            else if (string.IsNullOrWhiteSpace(protocol) && icmp is not null)
            {
                protocol = "ICMP";
            }

            var src = ip?.SourceAddress?.ToString();
            var dst = ip?.DestinationAddress?.ToString();

            var info = BuildInfo(protocol, tcp, udp, icmp);

            return new PacketCaptureRecord
            {
                Id = Interlocked.Increment(ref _nextId),
                CapturedAtUtc = capture.Timeval.Date.ToUniversalTime(),
                Source = src,
                Destination = dst,
                Protocol = protocol,
                Length = capture.Data.Length,
                SourcePort = tcp?.SourcePort ?? udp?.SourcePort,
                DestinationPort = tcp?.DestinationPort ?? udp?.DestinationPort,
                SourceMac = ethernet?.SourceHardwareAddress.ToString(),
                DestinationMac = ethernet?.DestinationHardwareAddress.ToString(),
                Info = info
            };
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to parse packet capture data");
            return null;
        }
    }

    private static string? BuildInfo(string? protocol, TcpPacket? tcp, UdpPacket? udp, IcmpV4Packet? icmp)
    {
        if (tcp is not null)
        {
            var flags = new List<string>(9);
            if (tcp.Synchronize)
            {
                flags.Add("SYN");
            }
            if (tcp.Acknowledgment)
            {
                flags.Add("ACK");
            }
            if (tcp.Push)
            {
                flags.Add("PSH");
            }
            if (tcp.Reset)
            {
                flags.Add("RST");
            }
            if (tcp.Finished)
            {
                flags.Add("FIN");
            }
            if (tcp.Urgent)
            {
                flags.Add("URG");
            }
            if (tcp.ExplicitCongestionNotificationEcho)
            {
                flags.Add("ECE");
            }
            if (tcp.CongestionWindowReduced)
            {
                flags.Add("CWR");
            }
            if (tcp.NonceSum)
            {
                flags.Add("NS");
            }

            var flagsText = flags.Count > 0 ? string.Join(',', flags) : tcp.Flags.ToString();
            return $"TCP {tcp.SourcePort} → {tcp.DestinationPort} Flags={flagsText}";
        }

        if (udp is not null)
        {
            return $"UDP {udp.SourcePort} → {udp.DestinationPort}";
        }

        if (icmp is not null)
        {
            return $"ICMP Type={icmp.TypeCode}";
        }

        return protocol;
    }
}
