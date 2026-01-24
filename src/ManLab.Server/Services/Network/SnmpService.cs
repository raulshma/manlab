using System.Net;
using System.Net.Sockets;
using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Messaging;
using Lextm.SharpSnmpLib.Security;

namespace ManLab.Server.Services.Network;

public sealed class SnmpService : ISnmpService
{
    private const int DefaultPort = 161;
    private const int DefaultTimeoutMs = 2000;
    private const int DefaultRetries = 1;
    private const int DefaultMaxResults = 2000;
    private const int MaxTimeoutMs = 10000;

    public async Task<IReadOnlyList<SnmpValue>> GetAsync(SnmpGetRequest request, CancellationToken ct)
    {
        ValidateHost(request.Host);
        if (request.Oids.Length == 0)
        {
            throw new ArgumentException("At least one OID is required");
        }

        var port = ClampPort(request.Port);
        var timeout = ClampTimeout(request.TimeoutMs);
        var retries = ClampRetries(request.Retries);
        var endpoint = await ResolveEndpointAsync(request.Host, port, ct);
        var variables = request.Oids.Select(ToVariable).ToList();

        if (request.Version == SnmpVersion.V3)
        {
            var creds = RequireV3(request.V3);
            var results = await ExecuteWithRetriesAsync(
                () => SendV3Get(endpoint, timeout, creds, variables),
                retries,
                ct);

            return results.Select(ToSnmpValue).ToList();
        }

        var community = new OctetString(string.IsNullOrWhiteSpace(request.Community) ? "public" : request.Community);
        var version = MapVersion(request.Version);

        var responseVars = await ExecuteWithRetriesAsync(
            () => SendGet(endpoint, timeout, version, community, variables),
            retries,
            ct);

        return responseVars.Select(ToSnmpValue).ToList();
    }

    public async Task<IReadOnlyList<SnmpValue>> WalkAsync(SnmpWalkRequest request, CancellationToken ct)
    {
        ValidateHost(request.Host);
        if (string.IsNullOrWhiteSpace(request.BaseOid))
        {
            throw new ArgumentException("Base OID is required");
        }

        var port = ClampPort(request.Port);
        var timeout = ClampTimeout(request.TimeoutMs);
        var retries = ClampRetries(request.Retries);
        var maxResults = Math.Clamp(request.MaxResults ?? DefaultMaxResults, 1, 10000);
        var endpoint = await ResolveEndpointAsync(request.Host, port, ct);
        var baseOid = ParseOid(request.BaseOid);
        var baseOidString = baseOid.ToString();
        var currentOid = baseOid;

        var results = new List<SnmpValue>();

        for (var i = 0; i < maxResults; i++)
        {
            ct.ThrowIfCancellationRequested();

            IReadOnlyList<Variable> vars;
            if (request.Version == SnmpVersion.V3)
            {
                var creds = RequireV3(request.V3);
                vars = await ExecuteWithRetriesAsync(
                    () => SendV3GetNext(endpoint, timeout, creds, currentOid),
                    retries,
                    ct);
            }
            else
            {
                var community = new OctetString(string.IsNullOrWhiteSpace(request.Community) ? "public" : request.Community);
                var version = MapVersion(request.Version);
                vars = await ExecuteWithRetriesAsync(
                    () => SendGetNext(endpoint, timeout, version, community, currentOid),
                    retries,
                    ct);
            }

            if (vars.Count == 0)
            {
                break;
            }

            var variable = vars[0];
            var oidString = variable.Id.ToString();

            if (!oidString.StartsWith(baseOidString + ".", StringComparison.Ordinal))
            {
                break;
            }

            results.Add(ToSnmpValue(variable));

            if (oidString == currentOid.ToString())
            {
                break;
            }

            currentOid = variable.Id;
        }

        return results;
    }

    public async Task<SnmpTableResult> TableAsync(SnmpTableRequest request, CancellationToken ct)
    {
        ValidateHost(request.Host);
        if (request.Columns.Length == 0)
        {
            throw new ArgumentException("At least one table column OID is required");
        }

        var port = ClampPort(request.Port);
        var timeout = ClampTimeout(request.TimeoutMs);
        var retries = ClampRetries(request.Retries);
        var maxResultsPerColumn = Math.Clamp(request.MaxResultsPerColumn ?? 500, 1, 5000);
        var endpoint = await ResolveEndpointAsync(request.Host, port, ct);

        var rowMap = new Dictionary<string, SnmpTableRow>(StringComparer.Ordinal);

        foreach (var columnOid in request.Columns)
        {
            ct.ThrowIfCancellationRequested();

            var columnRoot = ParseOid(columnOid);
            var columnRootString = columnRoot.ToString();

            var walkRequest = new SnmpWalkRequest
            {
                Host = request.Host,
                Port = port,
                Version = request.Version,
                Community = request.Community,
                V3 = request.V3,
                BaseOid = columnRootString,
                TimeoutMs = timeout,
                Retries = retries,
                MaxResults = maxResultsPerColumn
            };

            var columnValues = await WalkAsync(walkRequest, ct);
            foreach (var value in columnValues)
            {
                var index = GetTableIndex(columnRootString, value.Oid);
                if (index is null)
                {
                    continue;
                }

                if (!rowMap.TryGetValue(index, out var row))
                {
                    row = new SnmpTableRow { Index = index };
                    rowMap[index] = row;
                }

                row.Values[columnRootString] = value.Value;
            }
        }

        var rows = rowMap.Values.OrderBy(r => r.Index, StringComparer.Ordinal).ToList();

        return new SnmpTableResult
        {
            Host = request.Host,
            Port = port,
            Version = request.Version,
            BaseOid = request.BaseOid,
            Columns = request.Columns.ToList(),
            Rows = rows,
            DurationMs = 0
        };
    }

    private static IReadOnlyList<Variable> SendGet(
        IPEndPoint endpoint,
        int timeout,
        VersionCode version,
        OctetString community,
        IList<Variable> variables)
    {
        var requestMessage = new GetRequestMessage(
            Messenger.NextMessageId,
            version,
            community,
            variables);

        var response = requestMessage.GetResponse(timeout, endpoint);
        var pdu = response.Pdu();
        EnsureNoError(pdu);
        return pdu.Variables.ToList();
    }

    private static IReadOnlyList<Variable> SendGetNext(
        IPEndPoint endpoint,
        int timeout,
        VersionCode version,
        OctetString community,
        ObjectIdentifier oid)
    {
        var variables = new List<Variable> { new Variable(oid) };
        var requestMessage = new GetNextRequestMessage(
            Messenger.NextMessageId,
            version,
            community,
            variables);

        var response = requestMessage.GetResponse(timeout, endpoint);
        var pdu = response.Pdu();
        EnsureNoError(pdu);
        return pdu.Variables.ToList();
    }

    private static IReadOnlyList<Variable> SendV3Get(
        IPEndPoint endpoint,
        int timeout,
        SnmpV3Credentials creds,
        IList<Variable> variables)
    {
        var (_, privacyProvider) = CreateV3Providers(creds);
        var report = Discover(endpoint, timeout);

        var requestMessage = new GetRequestMessage(
            VersionCode.V3,
            Messenger.NextMessageId,
            Messenger.NextRequestId,
            new OctetString(creds.Username),
            new OctetString(creds.ContextName ?? string.Empty),
            variables,
            privacyProvider,
            Messenger.MaxMessageSize,
            report);

        var response = requestMessage.GetResponse(timeout, endpoint);
        var pdu = response.Pdu();
        EnsureNoError(pdu);
        return pdu.Variables.ToList();
    }

    private static IReadOnlyList<Variable> SendV3GetNext(
        IPEndPoint endpoint,
        int timeout,
        SnmpV3Credentials creds,
        ObjectIdentifier oid)
    {
        var (_, privacyProvider) = CreateV3Providers(creds);
        var report = Discover(endpoint, timeout);

        var variables = new List<Variable> { new Variable(oid) };
        var requestMessage = new GetNextRequestMessage(
            VersionCode.V3,
            Messenger.NextMessageId,
            Messenger.NextRequestId,
            new OctetString(creds.Username),
            new OctetString(creds.ContextName ?? string.Empty),
            variables,
            privacyProvider,
            Messenger.MaxMessageSize,
            report);

        var response = requestMessage.GetResponse(timeout, endpoint);
        var pdu = response.Pdu();
        EnsureNoError(pdu);
        return pdu.Variables.ToList();
    }

    private static ReportMessage Discover(IPEndPoint endpoint, int timeout)
    {
        var discovery = Messenger.GetNextDiscovery(SnmpType.GetRequestPdu);
        return discovery.GetResponse(timeout, endpoint);
    }

    private static (IAuthenticationProvider auth, IPrivacyProvider privacy) CreateV3Providers(SnmpV3Credentials creds)
    {
        #pragma warning disable CS0618
        IAuthenticationProvider authProvider = creds.AuthProtocol switch
        {
            SnmpAuthProtocol.Md5 => new MD5AuthenticationProvider(new OctetString(RequireAuthPassword(creds))),
            SnmpAuthProtocol.Sha1 => new SHA1AuthenticationProvider(new OctetString(RequireAuthPassword(creds))),
            _ => DefaultAuthenticationProvider.Instance
        };

        (IAuthenticationProvider auth, IPrivacyProvider privacy) providers = creds.PrivacyProtocol switch
        {
            SnmpPrivacyProtocol.Des => (authProvider, (IPrivacyProvider)new DESPrivacyProvider(new OctetString(RequirePrivacyPassword(creds)), authProvider)),
            SnmpPrivacyProtocol.Aes128 => (authProvider, (IPrivacyProvider)new AESPrivacyProvider(new OctetString(RequirePrivacyPassword(creds)), authProvider)),
            _ => (authProvider, (IPrivacyProvider)new DefaultPrivacyProvider(authProvider))
        };
        #pragma warning restore CS0618
        return providers;
    }

    private static string RequireAuthPassword(SnmpV3Credentials creds)
    {
        if (string.IsNullOrWhiteSpace(creds.AuthPassword))
        {
            throw new ArgumentException("SNMPv3 authentication password is required for the selected auth protocol");
        }

        return creds.AuthPassword;
    }

    private static string RequirePrivacyPassword(SnmpV3Credentials creds)
    {
        if (string.IsNullOrWhiteSpace(creds.PrivacyPassword))
        {
            throw new ArgumentException("SNMPv3 privacy password is required for the selected privacy protocol");
        }

        if (creds.AuthProtocol == SnmpAuthProtocol.None)
        {
            throw new ArgumentException("SNMPv3 privacy requires an authentication protocol");
        }

        return creds.PrivacyPassword;
    }

    private static async Task<IPEndPoint> ResolveEndpointAsync(string host, int port, CancellationToken ct)
    {
        if (IPAddress.TryParse(host, out var ip))
        {
            return new IPEndPoint(ip, port);
        }

        var addresses = await Dns.GetHostAddressesAsync(host, ct);
        var ipv4 = addresses.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
        var address = ipv4 ?? addresses.FirstOrDefault() ?? throw new ArgumentException("Unable to resolve host address");
        return new IPEndPoint(address, port);
    }

    private static Variable ToVariable(string oid)
    {
        try
        {
            return new Variable(new ObjectIdentifier(oid));
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            throw new ArgumentException($"Invalid OID: {oid}");
        }
    }

    private static ObjectIdentifier ParseOid(string oid)
    {
        try
        {
            return new ObjectIdentifier(oid);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            throw new ArgumentException($"Invalid OID: {oid}");
        }
    }

    private static SnmpValue ToSnmpValue(Variable variable)
    {
        return new SnmpValue
        {
            Oid = variable.Id.ToString(),
            Value = variable.Data.ToString(),
            DataType = variable.Data.TypeCode.ToString()
        };
    }

    private static SnmpV3Credentials RequireV3(SnmpV3Credentials? creds)
    {
        if (creds is null)
        {
            throw new ArgumentException("SNMPv3 credentials are required for v3 requests");
        }

        if (string.IsNullOrWhiteSpace(creds.Username))
        {
            throw new ArgumentException("SNMPv3 username is required");
        }

        return creds;
    }

    private static void ValidateHost(string host)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ArgumentException("Host is required");
        }
    }

    private static int ClampPort(int? port)
    {
        var value = port ?? DefaultPort;
        return Math.Clamp(value, 1, 65535);
    }

    private static int ClampTimeout(int? timeoutMs)
    {
        var value = timeoutMs ?? DefaultTimeoutMs;
        return Math.Clamp(value, 200, MaxTimeoutMs);
    }

    private static int ClampRetries(int? retries)
    {
        var value = retries ?? DefaultRetries;
        return Math.Clamp(value, 0, 5);
    }

    private static VersionCode MapVersion(SnmpVersion version)
    {
        return version switch
        {
            SnmpVersion.V1 => VersionCode.V1,
            SnmpVersion.V2c => VersionCode.V2,
            SnmpVersion.V3 => VersionCode.V3,
            _ => VersionCode.V2
        };
    }

    private static void EnsureNoError(ISnmpPdu pdu)
    {
        if (pdu.ErrorStatus.ToInt32() != (int)ErrorCode.NoError)
        {
            throw new InvalidOperationException($"SNMP error: {pdu.ErrorStatus.ToInt32()}");
        }
    }

    private static string? GetTableIndex(string columnOid, string valueOid)
    {
        if (!valueOid.StartsWith(columnOid + ".", StringComparison.Ordinal))
        {
            return null;
        }

        return valueOid[(columnOid.Length + 1)..];
    }

    private static async Task<IReadOnlyList<Variable>> ExecuteWithRetriesAsync(
        Func<IReadOnlyList<Variable>> action,
        int retries,
        CancellationToken ct)
    {
        var attempts = 0;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                return action();
            }
            catch (SocketException) when (attempts < retries)
            {
                attempts++;
            }
            catch (Lextm.SharpSnmpLib.Messaging.TimeoutException) when (attempts < retries)
            {
                attempts++;
            }
            catch (System.TimeoutException) when (attempts < retries)
            {
                attempts++;
            }
            catch (SnmpException) when (attempts < retries)
            {
                attempts++;
            }
        }
    }
}