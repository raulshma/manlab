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
}

/**
 * Traceroute result.
 */
export interface TracerouteResult {
  hostname: string;
  resolvedAddress: string | null;
  hops: TracerouteHop[];
  reachedDestination: boolean;
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
  | "PTR";

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
  | "discovery"
  | "wifi-scan"
  | "dns-lookup"
  | "whois"
  | "wol"
  | "ssl-inspect"
  | "mac-vendor"
  | "speedtest";

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
