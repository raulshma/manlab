/**
 * Network Scanning API client for ManLab Dashboard.
 * Provides functions for network scanning and discovery operations.
 */

import { api } from "../api";

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Ping request parameters.
 */
export interface PingRequest {
  host: string;
  timeout?: number;
  recordHistory?: boolean;
}

/**
 * Aggregated ping history record request.
 */
export interface PingAggregateHistoryRequest {
  host: string;
  timeout?: number;
  windowStartUtc: string;
  avgRtt: number;
  minRtt: number;
  maxRtt: number;
  totalPings: number;
  successfulPings: number;
  resolvedAddress?: string | null;
  ttl?: number | null;
}

/**
 * Ping result from the server.
 */
export interface PingResult {
  address: string;
  resolvedAddress: string | null;
  status: string;
  roundtripTime: number;
  ttl: number | null;
  isSuccess: boolean;
}

/**
 * Internet health snapshot request.
 */
export interface InternetHealthRequest {
  pingTargets?: string[];
  pingTimeoutMs?: number;
  dnsQuery?: string;
  includePublicIp?: boolean;
}

/**
 * Internet health ping snapshot.
 */
export interface InternetHealthPingSnapshot {
  target: string;
  result?: PingResult | null;
  durationMs: number;
  error?: string | null;
}

/**
 * Internet health DNS snapshot.
 */
export interface InternetHealthDnsSnapshot {
  query: string;
  durationMs: number;
  recordCount: number;
  success: boolean;
  error?: string | null;
}

/**
 * Internet health public IP snapshot.
 */
export interface InternetHealthPublicIpSnapshot {
  result?: PublicIpResult | null;
  durationMs: number;
  success: boolean;
  error?: string | null;
}

/**
 * Internet health combined snapshot.
 */
export interface InternetHealthResult {
  timestampUtc: string;
  pings: InternetHealthPingSnapshot[];
  dns: InternetHealthDnsSnapshot;
  publicIp?: InternetHealthPublicIpSnapshot | null;
}

/**
 * Subnet discovery request parameters.
 */
export interface SubnetDiscoverRequest {
  cidr: string;
  concurrencyLimit?: number;
  timeout?: number;
}

/**
 * Discovered host from subnet scan.
 */
export interface DiscoveredHost {
  ipAddress: string;
  hostname: string | null;
  macAddress: string | null;
  vendor: string | null;
  deviceType: string | null;
  roundtripTime: number;
  ttl: number | null;
}

/**
 * Subnet scan result.
 */
export interface SubnetScanResult {
  cidr: string;
  hosts: DiscoveredHost[];
  totalScanned: number;
  hostsFound: number;
  scanDurationMs: number;
}

/**
 * Network topology build request.
 */
export interface NetworkTopologyRequest {
  cidr: string;
  concurrencyLimit?: number;
  timeout?: number;
  includeDiscovery?: boolean;
  discoveryDurationSeconds?: number;
}

/**
 * Topology graph node.
 */
export interface NetworkTopologyNode {
  id: string;
  kind: "root" | "subnet" | "host" | "mdns" | "upnp" | string;
  label: string;
  ipAddress?: string | null;
  hostname?: string | null;
  macAddress?: string | null;
  vendor?: string | null;
  deviceType?: string | null;
  subnet?: string | null;
  source?: string | null;
  serviceType?: string | null;
  port?: number | null;
}

/**
 * Topology graph link.
 */
export interface NetworkTopologyLink {
  source: string;
  target: string;
  kind: string;
}

/**
 * Topology build summary.
 */
export interface NetworkTopologySummary {
  subnetCount: number;
  hostCount: number;
  discoveryOnlyHosts: number;
  mdnsServices: number;
  upnpDevices: number;
  totalNodes: number;
  totalLinks: number;
}

/**
 * Topology build result.
 */
export interface NetworkTopologyResult {
  cidr: string;
  nodes: NetworkTopologyNode[];
  links: NetworkTopologyLink[];
  startedAt: string;
  completedAt: string;
  summary: NetworkTopologySummary;
}

/**
 * Traceroute request parameters.
 */
export interface TracerouteRequest {
  host: string;
  maxHops?: number;
  timeout?: number;
}

/**
 * A single hop in a traceroute.
 */
export interface TracerouteHop {
  hopNumber: number;
  address: string | null;
  hostname: string | null;
  roundtripTime: number;
  status: string;
  countryCode?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  asn?: number | null;
  isp?: string | null;
}

/**
 * Traceroute result.
 */
export interface TracerouteResult {
  hostname: string;
  resolvedAddress: string | null;
  hops: TracerouteHop[];
  reachedDestination: boolean;
  geoLookupAvailable?: boolean;
  geoLookupCount?: number;
}

/**
 * Port scan request parameters.
 */
export interface PortScanRequest {
  host: string;
  ports?: number[];
  startPort?: number;
  endPort?: number;
  concurrencyLimit?: number;
  timeout?: number;
}

/**
 * Open port information.
 */
export interface OpenPort {
  port: number;
  serviceName: string | null;
  serviceDescription: string | null;
}

/**
 * Port scan result.
 */
export interface PortScanResult {
  host: string;
  resolvedAddress: string | null;
  openPorts: OpenPort[];
  scannedPorts: number;
  scanDurationMs: number;
}

/**
 * Device information request.
 */
export interface DeviceInfoRequest {
  ip: string;
}

/**
 * Device information result.
 */
export interface DeviceInfo {
  ipAddress: string;
  hostname: string | null;
  macAddress: string | null;
  vendor: string | null;
  deviceType: string | null;
  responseTimeMs: number | null;
}

/**
 * DNS record type.
 */
export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "MX"
  | "TXT"
  | "NS"
  | "SOA"
  | "PTR"
  | "SRV"
  | "CAA";

/**
 * DNS record.
 */
export interface DnsRecord {
  name: string;
  type: DnsRecordType;
  value: string;
  ttl?: number | null;
  priority?: number | null;
}

/**
 * DNS lookup request.
 */
export interface DnsLookupRequest {
  query: string;
  includeReverse?: boolean;
}

/**
 * DNS lookup result.
 */
export interface DnsLookupResult {
  query: string;
  records: DnsRecord[];
  reverseRecords: DnsRecord[];
}

/**
 * DNS propagation check request.
 */
export interface DnsPropagationRequest {
  query: string;
  servers?: string[];
  recordTypes?: DnsRecordType[];
  includeDefaultServers?: boolean;
  timeoutMs?: number;
}

/**
 * DNS propagation server result.
 */
export interface DnsPropagationServerResult {
  server: string;
  resolvedAddress?: string | null;
  records: DnsRecord[];
  error?: string | null;
  durationMs: number;
}

/**
 * DNS propagation check result.
 */
export interface DnsPropagationResult {
  query: string;
  recordTypes: DnsRecordType[];
  servers: DnsPropagationServerResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/**
 * WHOIS lookup request.
 */
export interface WhoisRequest {
  query: string;
}

/**
 * WHOIS lookup result.
 */
export interface WhoisResult {
  query: string;
  server: string | null;
  response: string;
}

/**
 * Public IP lookup result.
 */
export interface PublicIpResult {
  ipv4: string | null;
  ipv4Provider: string | null;
  ipv6: string | null;
  ipv6Provider: string | null;
  retrievedAt: string;
}

/**
 * Wake-on-LAN request.
 */
export interface WolRequest {
  macAddress: string;
  broadcastAddress?: string | null;
  port?: number | null;
}

/**
 * Wake-on-LAN result.
 */
export interface WolSendResult {
  macAddress: string;
  broadcastAddress: string;
  port: number;
  success: boolean;
  error?: string | null;
}

/**
 * MAC vendor lookup request.
 */
export interface MacVendorLookupRequest {
  macAddress: string;
}

/**
 * MAC vendor lookup result.
 */
export interface MacVendorLookupResult {
  macAddress: string;
  vendor: string | null;
  vendorCount: number;
}

/**
 * ARP table entry.
 */
export interface ArpTableEntry {
  ipAddress: string;
  macAddress: string;
  vendor?: string | null;
  interfaceName?: string | null;
  isStatic?: boolean | null;
}

/**
 * ARP table result.
 */
export interface ArpTableResult {
  entries: ArpTableEntry[];
  retrievedAt: string;
}

/**
 * Add static ARP entry request.
 */
export interface ArpAddStaticRequest {
  ipAddress: string;
  macAddress: string;
  interfaceName?: string | null;
}

/**
 * ARP operation result.
 */
export interface ArpOperationResult {
  success: boolean;
  error?: string | null;
  output?: string | null;
}

/**
 * Speed test request.
 */
export interface SpeedTestRequest {
  downloadSizeBytes?: number;
  uploadSizeBytes?: number;
  latencySamples?: number;
}

/**
 * Speed test metadata for high-fidelity UI.
 */
export interface SpeedTestMetadata {
  downloadSizeBytes: number;
  uploadSizeBytes: number;
  latencySamples: number;
  locateUrl?: string | null;
  downloadUrl?: string | null;
  uploadUrl?: string | null;
  serviceName?: string | null;
  serviceType?: string | null;
  clientName?: string | null;
  clientVersion?: string | null;
  clientLibraryName?: string | null;
  clientLibraryVersion?: string | null;
}

/**
 * Speed test progress for live UI.
 */
export interface SpeedTestProgress {
  phase: string;
  bytesTransferred: number;
  targetBytes: number;
  mbps: number | null;
  latencySampleMs: number | null;
  latencySamplesCollected: number;
  latencySamplesTarget: number;
  elapsedMs: number;
}

/**
 * Combined speed test update payload.
 */
export interface SpeedTestProgressUpdate {
  metadata?: SpeedTestMetadata | null;
  progress?: SpeedTestProgress | null;
  timestampUtc: string;
}

/**
 * Speed test result.
 */
export interface SpeedTestResult {
  startedAt: string;
  completedAt: string;
  success: boolean;
  downloadMbps: number | null;
  uploadMbps: number | null;
  downloadBytes: number;
  uploadBytes: number;
  latencyMinMs: number | null;
  latencyAvgMs: number | null;
  latencyMaxMs: number | null;
  jitterMs: number | null;
  downloadSizeBytes: number;
  uploadSizeBytes: number;
  latencySamples: number;
  locateUrl?: string | null;
  downloadUrl?: string | null;
  uploadUrl?: string | null;
  serviceName?: string | null;
  serviceType?: string | null;
  clientName?: string | null;
  clientVersion?: string | null;
  clientLibraryName?: string | null;
  clientLibraryVersion?: string | null;
  durationMs: number;
  error?: string | null;
}

/**
 * Speed test started event.
 */
export interface SpeedTestStartedEvent {
  startedAt: string;
  request: SpeedTestRequest;
}

/**
 * Speed test progress event.
 */
export interface SpeedTestProgressEvent {
  update: SpeedTestProgressUpdate;
}

/**
 * Speed test completed event.
 */
export interface SpeedTestCompletedEvent {
  result: SpeedTestResult;
}

/**
 * Speed test failed event.
 */
export interface SpeedTestFailedEvent {
  error: string;
}

/**
 * SSL inspection request.
 */
export interface SslInspectRequest {
  host: string;
  port?: number;
}

/**
 * SSL certificate info.
 */
export interface SslCertificateInfo {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  thumbprint: string;
  serialNumber: string;
  subjectAlternativeNames: string[];
  signatureAlgorithm?: string | null;
  publicKeyAlgorithm?: string | null;
  keySize?: number | null;
  isSelfSigned: boolean;
}

/**
 * SSL inspection result.
 */
export interface SslInspectionResult {
  host: string;
  port: number;
  retrievedAt: string;
  chain: SslCertificateInfo[];
  daysRemaining: number;
  isValidNow: boolean;
}

/**
 * SNMP protocol versions.
 */
export type SnmpVersion = "V1" | "V2c" | "V3";

/**
 * SNMPv3 authentication protocols.
 */
export type SnmpAuthProtocol = "None" | "Md5" | "Sha1";

/**
 * SNMPv3 privacy protocols.
 */
export type SnmpPrivacyProtocol = "None" | "Des" | "Aes128";

/**
 * SNMPv3 credentials.
 */
export interface SnmpV3Credentials {
  username: string;
  authProtocol?: SnmpAuthProtocol;
  privacyProtocol?: SnmpPrivacyProtocol;
  authPassword?: string | null;
  privacyPassword?: string | null;
  contextName?: string | null;
}

/**
 * SNMP GET request.
 */
export interface SnmpGetRequest {
  host: string;
  port?: number;
  version?: SnmpVersion;
  community?: string | null;
  v3?: SnmpV3Credentials | null;
  oids: string[];
  timeoutMs?: number;
  retries?: number;
}

/**
 * SNMP walk request.
 */
export interface SnmpWalkRequest {
  host: string;
  port?: number;
  version?: SnmpVersion;
  community?: string | null;
  v3?: SnmpV3Credentials | null;
  baseOid: string;
  timeoutMs?: number;
  retries?: number;
  maxResults?: number;
}

/**
 * SNMP table request.
 */
export interface SnmpTableRequest {
  host: string;
  port?: number;
  version?: SnmpVersion;
  community?: string | null;
  v3?: SnmpV3Credentials | null;
  baseOid?: string | null;
  columns: string[];
  timeoutMs?: number;
  retries?: number;
  maxResultsPerColumn?: number;
}

/**
 * SNMP value.
 */
export interface SnmpValue {
  oid: string;
  value: string | null;
  dataType?: string | null;
}

/**
 * SNMP GET result.
 */
export interface SnmpGetResult {
  host: string;
  port: number;
  version: SnmpVersion;
  values: SnmpValue[];
  durationMs: number;
}

/**
 * SNMP walk result.
 */
export interface SnmpWalkResult {
  host: string;
  port: number;
  version: SnmpVersion;
  baseOid: string;
  values: SnmpValue[];
  durationMs: number;
}

/**
 * SNMP table row.
 */
export interface SnmpTableRow {
  index: string;
  values: Record<string, string | null>;
}

/**
 * SNMP table result.
 */
export interface SnmpTableResult {
  host: string;
  port: number;
  version: SnmpVersion;
  baseOid?: string | null;
  columns: string[];
  rows: SnmpTableRow[];
  durationMs: number;
}

/**
 * mDNS/UPnP discovery request.
 */
export interface DiscoveryRequest {
  scanDurationSeconds?: number;
}

/**
 * mDNS service record.
 */
export interface MdnsService {
  serviceName?: string;
  name?: string;
  serviceType?: string;
  hostname?: string | null;
  ipAddresses?: string[];
  port?: number;
  txtRecords?: Record<string, string>;
  networkInterface?: string | null;
}

/**
 * UPnP device.
 */
export interface UpnpDevice {
  usn: string;
  friendlyName: string | null;
  manufacturer: string | null;
  modelName: string | null;
  modelNumber: string | null;
  deviceType?: string | null;
  notificationType?: string | null;
  location?: string | null;
  descriptionLocation?: string | null;
  ipAddress?: string | null;
  server?: string | null;
  services?: string[];
}

/**
 * Combined discovery scan result.
 */
export interface DiscoveryScanResult {
  mdnsServices?: MdnsService[];
  mdnsDevices?: MdnsService[];
  upnpDevices: UpnpDevice[];
  scanDurationMs?: number;
  durationMs?: number;
}

/**
 * mDNS-only discovery result.
 */
export interface MdnsDiscoveryResult {
  services?: MdnsService[];
  mdnsDevices?: MdnsService[];
  scanDurationMs?: number;
  durationMs?: number;
}

/**
 * UPnP-only discovery result.
 */
export interface UpnpDiscoveryResult {
  devices?: UpnpDevice[];
  upnpDevices?: UpnpDevice[];
  scanDurationMs?: number;
  durationMs?: number;
}

/**
 * WiFi support check response.
 */
export interface WifiSupportResponse {
  isSupported: boolean;
  reason: string | null;
}

/**
 * WiFi adapter information.
 */
export interface WifiAdapter {
  name: string;
  description: string | null;
  interfaceType: string | null;
  status: string;
}

/**
 * WiFi network information.
 */
export interface WifiNetwork {
  ssid: string;
  bssid: string;
  signalStrength: number;
  signalStrengthDbm: number | null;
  channel: number;
  frequency: number;
  band: string;
  securityType: string;
  isConnected: boolean;
  isHidden: boolean;
}

/**
 * WiFi scan request.
 */
export interface WifiScanRequest {
  adapterName?: string;
}

/**
 * WiFi scan result.
 */
export interface WifiScanResult {
  adapterName: string;
  networks: WifiNetwork[];
  scanDurationMs: number;
}

/**
 * Common mDNS service types.
 */
export interface MdnsServiceTypes {
  serviceTypes: string[];
}

// ============================================================================
// API Functions
// ============================================================================

const NETWORK_RETRYABLE_MESSAGE = /(429|too many requests|service unavailable|bad gateway|gateway timeout|failed to fetch|networkerror)/i;

export interface RequestOptions {
  signal?: AbortSignal;
}

async function withNetworkRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxRetries = 2;
  const baseDelayMs = 300;
  const maxDelayMs = 2000;

  let delay = baseDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = NETWORK_RETRYABLE_MESSAGE.test(message);

      if (!shouldRetry || attempt >= maxRetries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(maxDelayMs, delay * 2);
    }
  }

  // This should never be reached due to the loop logic, but TypeScript needs it
  throw new Error("Retry loop exhausted");
}

/**
 * Ping a single host.
 */
export async function pingHost(
  request: PingRequest,
  options?: RequestOptions
): Promise<PingResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<PingResult>(
      "/network/ping",
      request,
      options
    );
    return data;
  });
}

/**
 * Record aggregated ping history (used for infinite mode).
 */
export async function recordPingAggregateHistory(
  request: PingAggregateHistoryRequest,
  options?: RequestOptions
): Promise<{ id: string }> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<{ id: string }>(
      "/network/ping/aggregate",
      request,
      options
    );
    return data;
  });
}

/**
 * Update aggregated ping history entry (used for infinite mode).
 */
export async function updatePingAggregateHistory(
  id: string,
  request: PingAggregateHistoryRequest,
  options?: RequestOptions
): Promise<void> {
  await withNetworkRetry(async () => {
    await api.put(`/network/ping/aggregate/${encodeURIComponent(id)}`, request, options);
  });
}

/**
 * Retrieve an internet health snapshot.
 */
export async function getInternetHealthSnapshot(
  request: InternetHealthRequest,
  options?: RequestOptions
): Promise<InternetHealthResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<InternetHealthResult>(
      "/network/internet-health",
      request,
      options
    );
    return data;
  });
}

/**
 * Discover hosts on a subnet (CIDR notation).
 */
export async function discoverSubnet(
  request: SubnetDiscoverRequest,
  options?: RequestOptions
): Promise<SubnetScanResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SubnetScanResult>(
      "/network/discover",
      request,
      options
    );
    return data;
  });
}

/**
 * Build a network topology map for a subnet.
 */
export async function buildNetworkTopology(
  request: NetworkTopologyRequest,
  options?: RequestOptions
): Promise<NetworkTopologyResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<NetworkTopologyResult>(
      "/network/topology",
      request,
      options
    );
    return data;
  });
}

/**
 * Trace route to a host.
 */
export async function traceroute(
  request: TracerouteRequest,
  options?: RequestOptions
): Promise<TracerouteResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<TracerouteResult>(
      "/network/traceroute",
      request,
      options
    );
    return data;
  });
}

/**
 * Scan ports on a host.
 */
export async function scanPorts(
  request: PortScanRequest,
  options?: RequestOptions
): Promise<PortScanResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<PortScanResult>(
      "/network/ports",
      request,
      options
    );
    return data;
  });
}

/**
 * Get detailed information about a device by IP.
 */
export async function getDeviceInfo(ip: string): Promise<DeviceInfo> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<DeviceInfo>(`/network/device/${encodeURIComponent(ip)}`);
    return data;
  });
}

/**
 * Perform DNS lookup.
 */
export async function dnsLookup(
  request: DnsLookupRequest,
  options?: RequestOptions
): Promise<DnsLookupResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<DnsLookupResult>(
      "/network/dns",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform DNS propagation check.
 */
export async function dnsPropagationCheck(
  request: DnsPropagationRequest,
  options?: RequestOptions
): Promise<DnsPropagationResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<DnsPropagationResult>(
      "/network/dns/propagation",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform WHOIS lookup.
 */
export async function whoisLookup(
  request: WhoisRequest,
  options?: RequestOptions
): Promise<WhoisResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<WhoisResult>(
      "/network/whois",
      request,
      options
    );
    return data;
  });
}

/**
 * Get public IP address(es) for the server.
 */
export async function getPublicIp(
  options?: RequestOptions
): Promise<PublicIpResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<PublicIpResult>(
      "/network/public-ip",
      options
    );
    return data;
  });
}

/**
 * Send Wake-on-LAN magic packet.
 */
export async function sendWakeOnLan(
  request: WolRequest,
  options?: RequestOptions
): Promise<WolSendResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<WolSendResult>(
      "/network/wol",
      request,
      options
    );
    return data;
  });
}

/**
 * Lookup MAC vendor.
 */
export async function lookupMacVendor(
  request: MacVendorLookupRequest,
  options?: RequestOptions
): Promise<MacVendorLookupResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<MacVendorLookupResult>(
      "/network/mac/vendor",
      request,
      options
    );
    return data;
  });
}

/**
 * Get ARP table entries.
 */
export async function getArpTable(
  options?: RequestOptions
): Promise<ArpTableResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<ArpTableResult>(
      "/network/arp/table",
      options
    );
    return data;
  });
}

/**
 * Add or replace a static ARP entry.
 */
export async function addStaticArpEntry(
  request: ArpAddStaticRequest,
  options?: RequestOptions
): Promise<ArpOperationResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<ArpOperationResult>(
      "/network/arp/add-static",
      request,
      options
    );
    return data;
  });
}

/**
 * Delete a single ARP entry by IP.
 */
export async function deleteArpEntry(
  ipAddress: string,
  options?: RequestOptions
): Promise<ArpOperationResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.delete<ArpOperationResult>(
      `/network/arp/entry/${encodeURIComponent(ipAddress)}`,
      options
    );
    return data;
  });
}

/**
 * Flush the ARP cache.
 */
export async function flushArpCache(
  options?: RequestOptions
): Promise<ArpOperationResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<ArpOperationResult>(
      "/network/arp/flush",
      {},
      options
    );
    return data;
  });
}

/**
 * Run server-side speed test.
 */
export async function runSpeedTest(
  request: SpeedTestRequest = {},
  options?: RequestOptions
): Promise<SpeedTestResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SpeedTestResult>(
      "/network/speedtest",
      request,
      options
    );
    return data;
  });
}

/**
 * Inspect SSL/TLS certificate chain.
 */
export async function inspectCertificate(
  request: SslInspectRequest,
  options?: RequestOptions
): Promise<SslInspectionResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SslInspectionResult>(
      "/network/ssl/inspect",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform SNMP GET.
 */
export async function snmpGet(
  request: SnmpGetRequest,
  options?: RequestOptions
): Promise<SnmpGetResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SnmpGetResult>(
      "/network/snmp/get",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform SNMP walk.
 */
export async function snmpWalk(
  request: SnmpWalkRequest,
  options?: RequestOptions
): Promise<SnmpWalkResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SnmpWalkResult>(
      "/network/snmp/walk",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform SNMP table query.
 */
export async function snmpTable(
  request: SnmpTableRequest,
  options?: RequestOptions
): Promise<SnmpTableResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<SnmpTableResult>(
      "/network/snmp/table",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform combined mDNS and UPnP discovery.
 */
export async function discoverDevices(
  request: DiscoveryRequest = {},
  options?: RequestOptions
): Promise<DiscoveryScanResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<DiscoveryScanResult>(
      "/network/discovery",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform mDNS-only discovery.
 */
export async function discoverMdns(
  request: DiscoveryRequest = {},
  options?: RequestOptions
): Promise<MdnsDiscoveryResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<MdnsDiscoveryResult>(
      "/network/discovery/mdns",
      request,
      options
    );
    return data;
  });
}

/**
 * Perform UPnP/SSDP-only discovery.
 */
export async function discoverUpnp(
  request: DiscoveryRequest = {},
  options?: RequestOptions
): Promise<UpnpDiscoveryResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<UpnpDiscoveryResult>(
      "/network/discovery/upnp",
      request,
      options
    );
    return data;
  });
}

/**
 * Get available mDNS service types.
 */
export async function getMdnsServiceTypes(
  options?: RequestOptions
): Promise<MdnsServiceTypes> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<MdnsServiceTypes>(
      "/network/discovery/mdns/service-types",
      options
    );
    return data;
  });
}

/**
 * Check if WiFi scanning is supported on the server.
 */
export async function checkWifiSupport(
  options?: RequestOptions
): Promise<WifiSupportResponse> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<WifiSupportResponse>(
      "/network/wifi/supported",
      options
    );
    return data;
  });
}

/**
 * Get available WiFi adapters.
 */
export async function getWifiAdapters(
  options?: RequestOptions
): Promise<WifiAdapter[]> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<WifiAdapter[]>(
      "/network/wifi/adapters",
      options
    );
    return data;
  });
}

/**
 * Scan for WiFi networks.
 */
export async function scanWifi(
  request: WifiScanRequest = {},
  options?: RequestOptions
): Promise<WifiScanResult> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<WifiScanResult>(
      "/network/wifi/scan",
      request,
      options
    );
    return data;
  });
}

// ============================================================================
// Geolocation Types & Functions
// ============================================================================

/**
 * Available geolocation database source.
 */
export interface GeoDatabaseSource {
  id: string;
  name: string;
  description: string;
  license: string;
  downloadUrl: string;
  estimatedSizeBytes: number | null;
}

/**
 * Database metadata information.
 */
export interface GeoDatabaseInfo {
  buildDate: string | null;
  databaseType: string | null;
  recordCount: number | null;
}

/**
 * Geolocation database status.
 */
export interface GeoDatabaseStatus {
  isAvailable: boolean;
  databasePath: string | null;
  lastUpdated: string | null;
  fileSizeBytes: number | null;
  activeSourceId: string | null;
  metadata: GeoDatabaseInfo | null;
}

/**
 * Geolocation lookup result.
 */
export interface GeoLocationResult {
  ipAddress: string;
  countryCode: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  asn?: number | null;
  isp?: string | null;
  isFound: boolean;
}

/**
 * Geolocation lookup request.
 */
export interface GeoLookupRequest {
  ips: string[];
}

/**
 * Get the list of available geolocation database sources.
 */
export async function getGeolocationSources(
  options?: RequestOptions
): Promise<GeoDatabaseSource[]> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<GeoDatabaseSource[]>(
      "/network/geolocation/sources",
      options
    );
    return data;
  });
}

/**
 * Get the status of the IP geolocation database.
 */
export async function getGeolocationStatus(
  options?: RequestOptions
): Promise<GeoDatabaseStatus> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<GeoDatabaseStatus>(
      "/network/geolocation/status",
      options
    );
    return data;
  });
}

/**
 * Download the IP geolocation database from the default source.
 */
export async function downloadGeolocationDatabase(
  options?: RequestOptions
): Promise<{ success: boolean }> {
  const { data } = await api.post<{ success: boolean }>(
    "/network/geolocation/download",
    {},
    options
  );
  return data;
}

/**
 * Download the IP geolocation database from a specific source.
 */
export async function downloadGeolocationDatabaseFromSource(
  sourceId: string,
  options?: RequestOptions
): Promise<{ success: boolean; sourceId: string }> {
  const { data } = await api.post<{ success: boolean; sourceId: string }>(
    `/network/geolocation/download/${encodeURIComponent(sourceId)}`,
    {},
    options
  );
  return data;
}

/**
 * Update the IP geolocation database.
 */
export async function updateGeolocationDatabase(
  options?: RequestOptions
): Promise<{ success: boolean }> {
  const { data } = await api.put<{ success: boolean }>(
    "/network/geolocation/update",
    {},
    options
  );
  return data;
}

/**
 * Delete the installed IP geolocation database.
 */
export async function deleteGeolocationDatabase(
  options?: RequestOptions
): Promise<{ success: boolean }> {
  const { data } = await api.delete<{ success: boolean }>(
    "/network/geolocation/database",
    options
  );
  return data;
}

/**
 * Lookup geolocation for one or more IP addresses.
 */
export async function lookupGeolocation(
  ips: string[],
  options?: RequestOptions
): Promise<GeoLocationResult[]> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<GeoLocationResult[]>(
      "/network/geolocation/lookup",
      { ips },
      options
    );
    return data;
  });
}

// ============================================================================
// SignalR Event Types (for useNetworkHub)
// ============================================================================

/**
 * Subnet scan started event.
 */
export interface ScanStartedEvent {
  scanId: string;
  cidr: string;
  totalHosts: number;
}

/**
 * Subnet scan progress event.
 */
export interface ScanProgressEvent {
  scanId: string;
  scannedCount: number;
  totalCount: number;
  percentComplete: number;
}

/**
 * Host found during subnet scan event.
 */
export interface HostFoundEvent {
  scanId: string;
  host: DiscoveredHost;
}

/**
 * Hosts found during subnet scan (batched) event.
 */
export interface HostFoundBatchEvent {
  scanId: string;
  hosts: DiscoveredHost[];
}

/**
 * Subnet scan completed event.
 */
export interface ScanCompletedEvent {
  scanId: string;
  result: SubnetScanResult;
}

/**
 * Subnet scan failed event.
 */
export interface ScanFailedEvent {
  scanId: string;
  error: string;
}

/**
 * Traceroute started event.
 */
export interface TracerouteStartedEvent {
  host: string;
  maxHops: number;
}

/**
 * Traceroute hop event.
 */
export interface TracerouteHopEvent {
  hop: TracerouteHop;
}

/**
 * Traceroute completed event.
 */
export interface TracerouteCompletedEvent {
  result: TracerouteResult;
}

/**
 * Port scan started event.
 */
export interface PortScanStartedEvent {
  host: string;
  totalPorts: number;
}

/**
 * Open port found event.
 */
export interface PortFoundEvent {
  host: string;
  port: OpenPort;
}

/**
 * Port scan completed event.
 */
export interface PortScanCompletedEvent {
  result: PortScanResult;
}

/**
 * Device discovery started event.
 */
export interface DiscoveryStartedEvent {
  durationSeconds: number;
}

/**
 * mDNS device found event.
 */
export interface MdnsDeviceFoundEvent {
  service: MdnsService;
}

/**
 * UPnP device found event.
 */
export interface UpnpDeviceFoundEvent {
  device: UpnpDevice;
}

/**
 * Discovery completed event.
 */
export interface DiscoveryCompletedEvent {
  result: DiscoveryScanResult;
}

/**
 * WiFi scan started event.
 */
export interface WifiScanStartedEvent {
  adapterName: string;
}

/**
 * WiFi network found event.
 */
export interface WifiNetworkFoundEvent {
  network: WifiNetwork;
}

/**
 * WiFi scan completed event.
 */
export interface WifiScanCompletedEvent {
  result: WifiScanResult;
}

// ============================================================================
// Syslog + Packet Capture API
// ============================================================================

export async function getSyslogStatus(options?: RequestOptions): Promise<SyslogStatus> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<SyslogStatus>("/network/syslog/status", options);
    return data;
  });
}

export async function getRecentSyslogMessages(
  count: number = 200,
  options?: RequestOptions
): Promise<SyslogMessage[]> {
  return withNetworkRetry(async () => {
    const params = new URLSearchParams({ count: String(count) });
    const { data } = await api.get<SyslogMessage[]>(`/network/syslog/recent?${params.toString()}`, options);
    return data;
  });
}

export async function clearSyslogMessages(options?: RequestOptions): Promise<void> {
  await withNetworkRetry(async () => {
    await api.post("/network/syslog/clear", {}, options);
  });
}

export async function getPacketCaptureStatus(options?: RequestOptions): Promise<PacketCaptureStatus> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<PacketCaptureStatus>("/network/packet-capture/status", options);
    return data;
  });
}

export async function getPacketCaptureDevices(options?: RequestOptions): Promise<PacketCaptureDeviceInfo[]> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<PacketCaptureDeviceInfo[]>("/network/packet-capture/devices", options);
    return data;
  });
}

export async function getRecentCapturedPackets(
  count: number = 200,
  options?: RequestOptions
): Promise<PacketCaptureRecord[]> {
  return withNetworkRetry(async () => {
    const params = new URLSearchParams({ count: String(count) });
    const { data } = await api.get<PacketCaptureRecord[]>(`/network/packet-capture/recent?${params.toString()}`, options);
    return data;
  });
}

export async function startPacketCapture(
  request: PacketCaptureStartRequest,
  options?: RequestOptions
): Promise<PacketCaptureStatus> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<PacketCaptureStatus>("/network/packet-capture/start", request, options);
    return data;
  });
}

export async function stopPacketCapture(options?: RequestOptions): Promise<PacketCaptureStatus> {
  return withNetworkRetry(async () => {
    const { data } = await api.post<PacketCaptureStatus>("/network/packet-capture/stop", {}, options);
    return data;
  });
}

export async function clearPacketCapture(options?: RequestOptions): Promise<void> {
  await withNetworkRetry(async () => {
    await api.post("/network/packet-capture/clear", {}, options);
  });
}

// ============================================================================
// Syslog + Packet Capture Types
// ============================================================================

export interface SyslogStatus {
  enabled: boolean;
  isListening: boolean;
  port: number;
  error: string | null;
  bufferedCount: number;
  droppedCount: number;
}

export interface SyslogMessage {
  id: number;
  receivedAtUtc: string;
  facility: number | null;
  severity: number | null;
  host: string | null;
  appName: string | null;
  procId: string | null;
  msgId: string | null;
  message: string;
  raw: string;
  sourceIp: string | null;
  sourcePort: number | null;
}

export interface PacketCaptureStatus {
  enabled: boolean;
  isCapturing: boolean;
  deviceName: string | null;
  filter: string | null;
  error: string | null;
  bufferedCount: number;
  droppedCount: number;
}

export interface PacketCaptureDeviceInfo {
  name: string;
  description: string | null;
  isLoopback: boolean;
}

export interface PacketCaptureRecord {
  id: number;
  capturedAtUtc: string;
  source: string | null;
  destination: string | null;
  protocol: string | null;
  length: number;
  sourcePort: number | null;
  destinationPort: number | null;
  sourceMac: string | null;
  destinationMac: string | null;
  info: string | null;
}

export interface PacketCaptureBatchEvent {
  records: PacketCaptureRecord[];
}

export interface PacketCaptureStartRequest {
  deviceName?: string | null;
  filter?: string | null;
}

// ============================================================================
// Network Tool History Types & Functions
// ============================================================================

/**
 * Network tool types tracked in history.
 */
export type NetworkToolType =
  | "ping"
  | "traceroute"
  | "port-scan"
  | "subnet-scan"
  | "topology"
  | "discovery"
  | "wifi-scan"
  | "dns-lookup"
  | "dns-propagation"
  | "whois"
  | "public-ip"
  | "wol"
  | "ssl-inspect"
  | "mac-vendor"
  | "speedtest"
  | "snmp-query"
  | "arp-table";

/**
 * Network tool history entry from the server.
 */
export interface NetworkToolHistoryEntry {
  id: string;
  timestampUtc: string;
  toolType: NetworkToolType;
  target: string | null;
  inputJson: string | null;
  resultJson: string | null;
  success: boolean;
  durationMs: number;
  errorMessage: string | null;
  tags: string[];
  notes: string | null;
}

export type HistoryStatusFilter = "all" | "success" | "failed";
export type HistorySortBy = "timestamp" | "duration" | "tool" | "target" | "status";
export type HistorySortDir = "asc" | "desc";

export interface NetworkToolHistoryQueryParams {
  page?: number;
  pageSize?: number;
  toolTypes?: NetworkToolType[];
  status?: HistoryStatusFilter;
  search?: string;
  fromUtc?: string | null;
  toUtc?: string | null;
  sortBy?: HistorySortBy;
  sortDir?: HistorySortDir;
}

export interface NetworkToolHistoryQueryResult {
  items: NetworkToolHistoryEntry[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface UpdateHistoryMetadataRequest {
  tags: string[];
  notes?: string | null;
}

/**
 * Get recent network tool history entries.
 */
export async function getNetworkToolHistory(
  count: number = 50,
  toolType?: NetworkToolType,
  options?: RequestOptions
): Promise<NetworkToolHistoryEntry[]> {
  return withNetworkRetry(async () => {
    const params = new URLSearchParams();
    if (count) params.set("count", String(count));
    if (toolType) params.set("toolType", toolType);
    
    const { data } = await api.get<NetworkToolHistoryEntry[]>(
      `/network/history?${params.toString()}`,
      options
    );
    return data;
  });
}

/**
 * Query network tool history with advanced filtering.
 */
export async function queryNetworkToolHistory(
  params: NetworkToolHistoryQueryParams,
  options?: RequestOptions
): Promise<NetworkToolHistoryQueryResult> {
  return withNetworkRetry(async () => {
    const qs = new URLSearchParams();

    const add = (k: string, v: unknown) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (!s) return;
      qs.set(k, s);
    };

    if (params.page) add("page", Math.max(1, Math.floor(params.page)));
    if (params.pageSize) add("pageSize", Math.max(10, Math.min(200, Math.floor(params.pageSize))));
    if (params.toolTypes && params.toolTypes.length > 0) add("toolTypes", params.toolTypes.join(","));
    if (params.status && params.status !== "all") add("status", params.status);
    add("search", params.search);
    add("fromUtc", params.fromUtc);
    add("toUtc", params.toUtc);
    add("sortBy", params.sortBy ?? "timestamp");
    add("sortDir", params.sortDir ?? "desc");

    const url = `/network/history/query${qs.size ? `?${qs.toString()}` : ""}`;
    const { data } = await api.get<NetworkToolHistoryQueryResult>(url, options);
    return data;
  });
}

/**
 * Update tags and notes for a history entry.
 */
export async function updateNetworkToolHistoryMetadata(
  id: string,
  request: UpdateHistoryMetadataRequest,
  options?: RequestOptions
): Promise<NetworkToolHistoryEntry> {
  const { data } = await api.put<NetworkToolHistoryEntry>(
    `/network/history/${encodeURIComponent(id)}/metadata`,
    request,
    options
  );
  return data;
}

/**
 * Export network tool history for current filters.
 */
export async function exportNetworkToolHistory(
  params: NetworkToolHistoryQueryParams,
  format: "csv" | "json"
): Promise<Blob> {
  const qs = new URLSearchParams();
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  };

  if (params.toolTypes && params.toolTypes.length > 0) add("toolTypes", params.toolTypes.join(","));
  if (params.status && params.status !== "all") add("status", params.status);
  add("search", params.search);
  add("fromUtc", params.fromUtc);
  add("toUtc", params.toUtc);
  add("sortBy", params.sortBy ?? "timestamp");
  add("sortDir", params.sortDir ?? "desc");
  add("format", format);

  const url = `/api/network/history/export${qs.size ? `?${qs.toString()}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return response.blob();
}

/**
 * Get a single network tool history entry by ID.
 */
export async function getNetworkToolHistoryById(
  id: string,
  options?: RequestOptions
): Promise<NetworkToolHistoryEntry> {
  return withNetworkRetry(async () => {
    const { data } = await api.get<NetworkToolHistoryEntry>(
      `/network/history/${encodeURIComponent(id)}`,
      options
    );
    return data;
  });
}

/**
 * Delete a single network tool history entry.
 */
export async function deleteNetworkToolHistoryEntry(
  id: string,
  options?: RequestOptions
): Promise<void> {
  await api.delete(`/network/history/${encodeURIComponent(id)}`, options);
}

/**
 * Delete history entries older than the specified number of days.
 */
export async function deleteOldNetworkToolHistory(
  daysOld: number = 30,
  options?: RequestOptions
): Promise<{ deletedCount: number }> {
  const { data } = await api.delete<{ deletedCount: number }>(
    `/network/history?daysOld=${daysOld}`,
    options
  );
  return data;
}
