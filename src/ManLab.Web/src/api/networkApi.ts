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
  responseTimeMs: number | null;
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
  serviceName: string;
  serviceType: string;
  hostname: string;
  ipAddresses: string[];
  port: number;
  txtRecords: Record<string, string>;
  networkInterface: string | null;
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
  deviceType: string | null;
  location: string | null;
  services: string[];
}

/**
 * Combined discovery scan result.
 */
export interface DiscoveryScanResult {
  mdnsServices: MdnsService[];
  upnpDevices: UpnpDevice[];
  scanDurationMs: number;
}

/**
 * mDNS-only discovery result.
 */
export interface MdnsDiscoveryResult {
  services: MdnsService[];
  scanDurationMs: number;
}

/**
 * UPnP-only discovery result.
 */
export interface UpnpDiscoveryResult {
  devices: UpnpDevice[];
  scanDurationMs: number;
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

/**
 * Ping a single host.
 */
export async function pingHost(request: PingRequest): Promise<PingResult> {
  const { data } = await api.post<PingResult>("/network/ping", request);
  return data;
}

/**
 * Discover hosts on a subnet (CIDR notation).
 */
export async function discoverSubnet(
  request: SubnetDiscoverRequest
): Promise<SubnetScanResult> {
  const { data } = await api.post<SubnetScanResult>(
    "/network/discover",
    request
  );
  return data;
}

/**
 * Trace route to a host.
 */
export async function traceroute(
  request: TracerouteRequest
): Promise<TracerouteResult> {
  const { data } = await api.post<TracerouteResult>(
    "/network/traceroute",
    request
  );
  return data;
}

/**
 * Scan ports on a host.
 */
export async function scanPorts(
  request: PortScanRequest
): Promise<PortScanResult> {
  const { data } = await api.post<PortScanResult>("/network/ports", request);
  return data;
}

/**
 * Get detailed information about a device by IP.
 */
export async function getDeviceInfo(ip: string): Promise<DeviceInfo> {
  const { data } = await api.get<DeviceInfo>(`/network/device/${encodeURIComponent(ip)}`);
  return data;
}

/**
 * Perform combined mDNS and UPnP discovery.
 */
export async function discoverDevices(
  request: DiscoveryRequest = {}
): Promise<DiscoveryScanResult> {
  const { data } = await api.post<DiscoveryScanResult>(
    "/network/discovery",
    request
  );
  return data;
}

/**
 * Perform mDNS-only discovery.
 */
export async function discoverMdns(
  request: DiscoveryRequest = {}
): Promise<MdnsDiscoveryResult> {
  const { data } = await api.post<MdnsDiscoveryResult>(
    "/network/discovery/mdns",
    request
  );
  return data;
}

/**
 * Perform UPnP/SSDP-only discovery.
 */
export async function discoverUpnp(
  request: DiscoveryRequest = {}
): Promise<UpnpDiscoveryResult> {
  const { data } = await api.post<UpnpDiscoveryResult>(
    "/network/discovery/upnp",
    request
  );
  return data;
}

/**
 * Get available mDNS service types.
 */
export async function getMdnsServiceTypes(): Promise<MdnsServiceTypes> {
  const { data } = await api.get<MdnsServiceTypes>(
    "/network/discovery/mdns/service-types"
  );
  return data;
}

/**
 * Check if WiFi scanning is supported on the server.
 */
export async function checkWifiSupport(): Promise<WifiSupportResponse> {
  const { data } = await api.get<WifiSupportResponse>("/network/wifi/supported");
  return data;
}

/**
 * Get available WiFi adapters.
 */
export async function getWifiAdapters(): Promise<WifiAdapter[]> {
  const { data } = await api.get<WifiAdapter[]>("/network/wifi/adapters");
  return data;
}

/**
 * Scan for WiFi networks.
 */
export async function scanWifi(
  request: WifiScanRequest = {}
): Promise<WifiScanResult> {
  const { data } = await api.post<WifiScanResult>("/network/wifi/scan", request);
  return data;
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
