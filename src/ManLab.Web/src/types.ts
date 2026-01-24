/**
 * TypeScript types matching server DTOs for the ManLab Dashboard.
 */

/**
 * Node status enum matching server-side enum.
 */
export type NodeStatus = 'Online' | 'Offline' | 'Maintenance' | 'Error';

/**
 * Node information returned by the API.
 * Matches the NodeDto from DevicesController.
 */
export interface Node {
  id: string;
  hostname: string;
  ipAddress: string | null;
  os: string | null;
  agentVersion: string | null;
  macAddress: string | null;
  lastSeen: string;
  status: NodeStatus;
  createdAt: string;
  // Error state fields
  errorCode: number | null;
  errorMessage: string | null;
  errorAt: string | null;
}

/**
 * Telemetry snapshot data from a node.
 * Matches the TelemetryDto from DevicesController.
 */
export interface Telemetry {
  timestamp: string;
  cpuUsage: number;
  ramUsage: number;
  diskUsage: number;
  temperature: number | null;
}

/**
 * Real-time telemetry update from SignalR.
 */
export interface TelemetryUpdate {
  nodeId: string;
  cpuPercent: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  diskUsage: Record<string, number>;
  cpuTempCelsius: number | null;
}

/**
 * Node status change event from SignalR.
 */
export interface NodeStatusChange {
  nodeId: string;
  status: NodeStatus;
  lastSeen: string;
}

/**
 * Agent backoff status from SignalR when heartbeat fails.
 */
export interface AgentBackoffStatus {
  nodeId: string;
  consecutiveFailures: number;
  nextRetryTimeUtc: string | null;
}

/**
 * Agent ping response from SignalR after admin-triggered ping.
 */
export interface AgentPingResponse {
  nodeId: string;
  success: boolean;
  nextRetryTimeUtc: string | null;
}

/**
 * Docker container status.
 */
export type ContainerState = 'running' | 'exited' | 'created' | 'paused' | 'restarting' | 'dead';

/**
 * Docker container information.
 */
export interface Container {
  id: string;
  names: string[];
  image: string;
  state: ContainerState;
  status: string;
  created: string;
}

/**
 * Command execution status.
 */
export type CommandExecutionStatus = 'Queued' | 'Sent' | 'InProgress' | 'Success' | 'Failed';

/**
 * Command record from the server.
 */
export interface Command {
  id: string;
  commandType: string;
  payload: string | null;
  status: CommandExecutionStatus;
  outputLog: string | null;
  createdAt: string;
  executedAt: string | null;
}

/**
 * Per-node setting record.
 */
export interface NodeSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
  updatedAt: string;
}

/**
 * SSH onboarding
 */

export type SshAuthMode = 'Password' | 'PrivateKey';

export type OnboardingStatus = 'Pending' | 'Running' | 'Succeeded' | 'Failed';

export interface OnboardingMachine {
  id: string;
  host: string;
  port: number;
  username: string;
  authMode: SshAuthMode;
  hostKeyFingerprint: string | null;
  status: OnboardingStatus;
  lastError: string | null;
  linkedNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  // New fields for saved credentials and configuration
  hasSavedCredentials?: boolean;
  hasSavedSudoPassword?: boolean;
  trustHostKey?: boolean;
  forceInstall?: boolean;
  runAsRoot?: boolean;
  serverBaseUrlOverride?: string | null;
}

export interface SshTestResponse {
  success: boolean;
  hostKeyFingerprint: string | null;
  requiresHostKeyTrust: boolean;
  whoAmI: string | null;
  osHint: string | null;
  hasExistingInstallation: boolean;
  detectedServerUrls: string[];
  error: string | null;
  useSavedCredentials?: boolean;
}

export interface StartInstallResponse {
  machineId: string;
  status: OnboardingStatus;
}

export interface StartUninstallResponse {
  machineId: string;
  status: OnboardingStatus;
}

/**
 * Agent releases / versions
 */

export interface AgentLocalReleaseItem {
  version: string; // e.g. "staged" or "v1.2.3"
  rids: string[];
  binaryLastWriteTimeUtc: string | null;
}

export interface AgentGitHubReleaseItem {
  tag: string;
  name: string | null;
  publishedAtUtc: string | null;
  prerelease: boolean;
  draft: boolean;
}

export interface AgentGitHubReleaseCatalog {
  enabled: boolean;
  releaseBaseUrl: string | null;
  configuredLatestVersion: string | null;
  repo: string | null;
  releases: AgentGitHubReleaseItem[];
  error: string | null;
}

export interface AgentReleaseCatalogResponse {
  channel: string;
  local: AgentLocalReleaseItem[];
  gitHub: AgentGitHubReleaseCatalog;
}

export interface InventorySection {
  label: string;
  items: string[];
}

export interface UninstallPreviewResponse {
  success: boolean;
  hostKeyFingerprint: string | null;
  requiresHostKeyTrust: boolean;
  osHint: string | null;
  sections: InventorySection[];
  error: string | null;
}

// New types for managing saved credentials and configuration
export interface SaveCredentialsRequest {
  password?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
  sudoPassword?: string;
  rememberCredentials?: boolean;
}

export interface UpdateConfigurationRequest {
  trustHostKey?: boolean;
  forceInstall?: boolean;
  runAsRoot?: boolean;
  serverBaseUrlOverride?: string | null;
}

export interface OnboardingLogEvent {
  machineId: string;
  timestamp: string;
  message: string;
}

/**
 * Local agent installation
 */

export interface LocalAgentStatus {
  isSupported: boolean;
  isInstalled: boolean;
  isRunning: boolean;
  linkedNodeId: string | null;
  status: string;
  currentOperation: string | null;
  installMode: "System" | "User" | null;
  hasSystemFiles: boolean;
  hasUserFiles: boolean;
  hasSystemTask: boolean;
  hasUserTask: boolean;
  orphanedResources: OrphanedResources | null;
}

export interface OrphanedResources {
  systemDirectory: FileDirectoryInfo | null;
  userDirectory: FileDirectoryInfo | null;
  systemTask: TaskInfo | null;
  userTask: TaskInfo | null;
}

export interface FileDirectoryInfo {
  path: string;
  totalSizeBytes: number;
  fileCount: number;
  files: string[];
}

export interface TaskInfo {
  name: string;
  state: string;
  lastRunTime: string | null;
  nextRunTime: string | null;
}

export interface LocalAgentInstallResponse {
  started: boolean;
  error: string | null;
}

/**
 * Agent configuration for installation.
 */
export interface AgentConfiguration {
  heartbeatIntervalSeconds: number;
  maxReconnectDelaySeconds: number;

  telemetryCacheSeconds: number;
  primaryInterfaceName: string | null;

  enableNetworkTelemetry: boolean;
  enablePingTelemetry: boolean;
  enableGpuTelemetry: boolean;
  enableUpsTelemetry: boolean;

  pingTarget: string | null;
  pingTimeoutMs: number;
  pingWindowSize: number;

  enableLogViewer: boolean;
  enableScripts: boolean;
  enableTerminal: boolean;
  enableFileBrowser: boolean;

  logMaxBytes: number;
  logMinSecondsBetweenRequests: number;

  scriptMaxOutputBytes: number;
  scriptMaxDurationSeconds: number;
  scriptMinSecondsBetweenRuns: number;

  terminalMaxOutputBytes: number;
  terminalMaxDurationSeconds: number;

  fileBrowserMaxBytes: number;
}

/**
 * Enhancements: Service monitoring config
 */
export interface ServiceMonitorConfig {
  id: string;
  nodeId: string;
  serviceName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Monitoring: HTTP health monitor configuration
 */
export interface HttpMonitorConfig {
  id: string;
  name: string;
  url: string;
  method: string | null;
  expectedStatus: number | null;
  bodyContains: string | null;
  timeoutMs: number;
  cron: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAtUtc: string | null;
  lastSuccessAtUtc: string | null;
}

export interface HttpMonitorCheck {
  id: number;
  monitorId: string;
  timestampUtc: string;
  statusCode: number | null;
  success: boolean;
  responseTimeMs: number;
  keywordMatched: boolean | null;
  sslDaysRemaining: number | null;
  errorMessage: string | null;
}

/**
 * Monitoring: traffic monitor config + samples
 */
export interface TrafficMonitorConfig {
  id: string;
  interfaceName: string | null;
  cron: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAtUtc: string | null;
}

export interface TrafficSample {
  id: number;
  interfaceName: string;
  timestampUtc: string;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  rxErrors: number | null;
  txErrors: number | null;
  speedBps: number | null;
  utilizationPercent: number | null;
}

/**
 * Monitoring: job summary
 */
export interface MonitorJobSummary {
  id: string;
  type: "http" | "traffic";
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAtUtc: string | null;
  nextRunAtUtc: string | null;
}

/**
 * Enhancements: Log viewer policy + session
 */
export interface LogViewerPolicy {
  id: string;
  nodeId: string;
  displayName: string;
  path: string;
  maxBytesPerRequest: number;
  createdAt: string;
  updatedAt: string;
}

export interface LogViewerSession {
  sessionId: string;
  nodeId: string;
  policyId: string;
  displayName: string;
  path: string;
  maxBytesPerRequest: number;
  expiresAt: string;
}

/**
 * Enhancements: File browser policy + session
 */
export interface FileBrowserPolicy {
  id: string;
  nodeId: string;
  displayName: string;
  rootPath: string;
  maxBytesPerRead: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileBrowserSession {
  sessionId: string;
  nodeId: string;
  policyId: string;
  displayName: string;
  rootPath: string;
  maxBytesPerRead: number;
  expiresAt: string;
}

export interface FileBrowserEntry {
  name: string;
  isDirectory: boolean;
  path: string;
  updatedAt?: string | null;
  size?: number | null;
}

export interface FileReadResult {
  path: string;
  contentBase64: string;
  truncated: boolean;
  bytesRead: number;
  offset?: number;
  totalBytes?: number;
}

export interface FileBrowserListResponse {
  sessionId: string;
  nodeId: string;
  path: string;
  entries: FileBrowserEntry[];
  truncated: boolean;
  commandId: string;
  status: string;
  error?: string | null;
}

export interface FileBrowserReadResponse {
  sessionId: string;
  nodeId: string;
  path: string;
  result: FileReadResult | null;
  commandId: string;
  status: string;
  error?: string | null;
}

/**
 * Enhancements: Scripts + runs
 */
export type ScriptShell = "Bash" | "PowerShell";

export interface ScriptSummary {
  id: string;
  name: string;
  description: string | null;
  shell: ScriptShell;
  isReadOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Script extends ScriptSummary {
  content: string;
}

export type ScriptRunStatus = "Queued" | "Sent" | "InProgress" | "Success" | "Failed" | "Cancelled";

export interface ScriptRun {
  id: string;
  nodeId: string;
  scriptId: string;
  requestedBy: string | null;
  status: ScriptRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
}

export interface CreateScriptRunResponse {
  runId: string;
  commandId: string;
}

/**
 * Enhancements: Telemetry history DTOs
 */
export interface NetworkTelemetryPoint {
  timestamp: string;
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
}

export interface PingTelemetryPoint {
  timestamp: string;
  pingTarget: string | null;
  pingRttMs: number | null;
  pingPacketLossPercent: number | null;
}

export interface ServiceStatusSnapshot {
  timestamp: string;
  serviceName: string;
  state: string;
  detail: string | null;
}

export interface SmartDriveSnapshot {
  timestamp: string;
  device: string;
  health: string;
  temperatureC: number | null;
  powerOnHours: number | null;
}

export interface GpuSnapshot {
  timestamp: string;
  gpuIndex: number;
  vendor: string;
  name: string | null;
  utilizationPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  temperatureC: number | null;
}

export interface UpsSnapshot {
  timestamp: string;
  backend: string;
  batteryPercent: number | null;
  loadPercent: number | null;
  onBattery: boolean | null;
  estimatedRuntimeSeconds: number | null;
}

/**
 * Agent resource usage telemetry.
 */
export interface AgentResourceUsage {
  timestamp: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  gcHeapBytes: number | null;
  threadCount: number | null;
}

/**
 * Server activity/audit events (GET /api/audit-events)
 */
export interface AuditEvent {
  id: string;
  timestampUtc: string;
  kind: string;
  eventName: string;
  category: string | null;
  message: string | null;
  success: boolean | null;
  source: string | null;
  actorType: string | null;
  actorId: string | null;
  actorName: string | null;
  actorIp: string | null;
  nodeId: string | null;
  commandId: string | null;
  sessionId: string | null;
  machineId: string | null;
  httpStatusCode: number | null;
  httpMethod: string | null;
  httpPath: string | null;
  hub: string | null;
  hubMethod: string | null;
  connectionId: string | null;
  requestId: string | null;
  traceId: string | null;
  spanId: string | null;
  dataJson: string | null;
  error: string | null;
}

/**
 * Enhancements: Log viewer responses
 */
export interface LogReadResponse {
  sessionId: string;
  nodeId: string;
  path: string;
  content: string;
  commandId: string;
  status: string;
  error: string | null;
}

export interface LogTailResponse {
  sessionId: string;
  nodeId: string;
  path: string;
  content: string;
  commandId: string;
  status: string;
}

/**
 * Enhancements: Terminal session types
 */
export interface TerminalOpenResponse {
  sessionId: string;
  nodeId: string;
  expiresAt: string;
  commandId: string;
  warning: string;
}

export interface TerminalInputResponse {
  sessionId: string;
  commandId: string;
  success: boolean;
}

export interface TerminalCloseResponse {
  sessionId: string;
  closed: boolean;
}

export interface TerminalSessionResponse {
  sessionId: string;
  nodeId: string;
  expiresAt: string;
  isExpired: boolean;
  requestedBy: string | null;
  warning?: string;
}

export interface CancelScriptRunResponse {
  commandId?: string;
  message: string;
}


// ============================================================================
// Enhanced Telemetry Types
// ============================================================================

/**
 * Enhanced GPU telemetry with detailed metrics.
 */
export interface EnhancedGpuTelemetry {
  vendor: string;
  index: number;
  name: string | null;
  driverVersion: string | null;
  uuid: string | null;
  pciBusId: string | null;

  // Utilization
  utilizationPercent: number | null;
  memoryUtilizationPercent: number | null;
  encoderUtilizationPercent: number | null;
  decoderUtilizationPercent: number | null;

  // Memory
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryFreeBytes: number | null;

  // Temperature
  temperatureC: number | null;
  memoryTemperatureC: number | null;
  hotspotTemperatureC: number | null;
  throttleTemperatureC: number | null;

  // Power
  powerDrawWatts: number | null;
  powerLimitWatts: number | null;
  defaultPowerLimitWatts: number | null;
  maxPowerLimitWatts: number | null;

  // Clocks
  graphicsClockMhz: number | null;
  memoryClockMhz: number | null;
  maxGraphicsClockMhz: number | null;
  maxMemoryClockMhz: number | null;

  // Fan & Performance
  fanSpeedPercent: number | null;
  performanceState: string | null;
  isThrottling: boolean | null;
  throttleReasons: string[] | null;

  // Process-level usage
  processes: GpuProcessInfo[] | null;
}

/**
 * Information about a process using GPU resources.
 */
export interface GpuProcessInfo {
  processId: number;
  processName: string | null;
  memoryUsedBytes: number | null;
  utilizationPercent: number | null;
  usageType: string | null;
}

/**
 * Enhanced network telemetry data.
 */
export interface NetworkTelemetry {
  interfaces: NetworkInterfaceTelemetry[];
  latencyMeasurements: LatencyMeasurement[];
  connections: ConnectionsSummary | null;
  discoveredDevices: DiscoveredDevice[];
  lastDiscoveryScanUtc: string | null;
}

/**
 * Per-interface network statistics.
 */
export interface NetworkInterfaceTelemetry {
  name: string;
  description: string | null;
  interfaceType: string | null;
  status: string;
  speedBps: number | null;
  macAddress: string | null;
  iPv4Addresses: string[];
  iPv6Addresses: string[];
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  totalRxBytes: number | null;
  totalTxBytes: number | null;
  rxPacketsPerSec: number | null;
  txPacketsPerSec: number | null;
  rxErrors: number | null;
  txErrors: number | null;
  rxDropped: number | null;
  txDropped: number | null;
  utilizationPercent: number | null;
}

/**
 * Network latency measurement to a specific target.
 */
export interface LatencyMeasurement {
  target: string;
  rttMs: number | null;
  minRttMs: number | null;
  maxRttMs: number | null;
  avgRttMs: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  hopCount: number | null;
}

/**
 * Summary of active network connections.
 */
export interface ConnectionsSummary {
  tcpEstablished: number;
  tcpTimeWait: number;
  tcpCloseWait: number;
  tcpListening: number;
  udpEndpoints: number;
  topConnections: ConnectionInfo[];
}

/**
 * Information about a network connection.
 */
export interface ConnectionInfo {
  localEndpoint: string;
  remoteEndpoint: string;
  state: string;
  processId: number | null;
  processName: string | null;
}

/**
 * A discovered network device.
 */
export interface DiscoveredDevice {
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  vendor: string | null;
  isReachable: boolean;
  responseTimeMs: number | null;
  firstSeenUtc: string;
  lastSeenUtc: string;
}

/**
 * Application Performance Monitoring (APM) telemetry data.
 */
export interface ApplicationPerformanceTelemetry {
  applications: ApplicationMetrics[];
  databases: DatabaseMetrics[];
  endpoints: EndpointMetrics[];
  systemThroughput: ThroughputMetrics | null;
}

/**
 * Metrics for a monitored application or service.
 */
export interface ApplicationMetrics {
  name: string;
  processId: number | null;
  applicationType: string | null;
  version: string | null;
  isHealthy: boolean;
  healthCheckUrl: string | null;
  healthCheckResponseTimeMs: number | null;

  // Response Time
  avgResponseTimeMs: number | null;
  p50ResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  p99ResponseTimeMs: number | null;
  maxResponseTimeMs: number | null;

  // Error Rates
  totalRequests: number;
  successfulRequests: number;
  clientErrors: number;
  serverErrors: number;
  errorRatePercent: number | null;

  // Throughput
  requestsPerSecond: number | null;
  bytesReceivedPerSec: number | null;
  bytesSentPerSec: number | null;

  // Resource Usage
  cpuPercent: number | null;
  memoryBytes: number | null;
  activeConnections: number | null;
  connectionPoolSize: number | null;
  connectionPoolAvailable: number | null;
  uptimeSeconds: number | null;
  lastRestartUtc: string | null;
}

/**
 * Database performance metrics.
 */
export interface DatabaseMetrics {
  name: string;
  databaseType: string | null;
  host: string | null;
  port: number | null;
  isReachable: boolean;
  connectionLatencyMs: number | null;

  // Query Performance
  totalQueries: number;
  avgQueryTimeMs: number | null;
  p95QueryTimeMs: number | null;
  maxQueryTimeMs: number | null;
  queriesPerSecond: number | null;
  failedQueries: number;

  // Connection Pool
  activeConnections: number | null;
  idleConnections: number | null;
  maxConnections: number | null;
  connectionWaitTimeMs: number | null;

  // Slow Queries
  slowQueries: SlowQueryInfo[] | null;
}

/**
 * Information about a slow database query.
 */
export interface SlowQueryInfo {
  query: string;
  executionTimeMs: number;
  executedAtUtc: string;
  rowsAffected: number | null;
  databaseName: string | null;
}

/**
 * HTTP endpoint performance metrics.
 */
export interface EndpointMetrics {
  path: string;
  method: string;
  totalRequests: number;
  avgResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  errorRatePercent: number | null;
  requestsPerSecond: number | null;
  mostCommonStatusCode: number | null;
}

/**
 * System-wide throughput metrics.
 */
export interface ThroughputMetrics {
  totalRequestsPerSecond: number;
  totalBytesReceivedPerSec: number;
  totalBytesSentPerSec: number;
  peakRequestsPerSecond: number;
  avgLatencyMs: number | null;
  overallErrorRatePercent: number | null;
  windowStartUtc: string;
  windowDurationSeconds: number;
}

/**
 * Extended TelemetryUpdate with enhanced telemetry fields.
 */
export interface ExtendedTelemetryUpdate extends TelemetryUpdate {
  // Enhanced GPU telemetry
  enhancedGpus: EnhancedGpuTelemetry[] | null;

  // Enhanced network telemetry
  network: NetworkTelemetry | null;

  // Application Performance Monitoring
  apm: ApplicationPerformanceTelemetry | null;
}

/**
 * Database endpoint configuration for APM.
 */
export interface DatabaseEndpointConfig {
  name: string;
  databaseType: string;
  host: string;
  port: number;
}

/**
 * Extended AgentConfiguration with enhanced telemetry settings.
 */
export interface ExtendedAgentConfiguration extends AgentConfiguration {
  enableEnhancedNetworkTelemetry: boolean;
  enableEnhancedGpuTelemetry: boolean;
  enableApmTelemetry: boolean;
  apmHealthCheckEndpoints: string[];
  apmDatabaseEndpoints: DatabaseEndpointConfig[];
}

// ============================================================================
// File Download Types
// ============================================================================

/**
 * Status of a download operation.
 */
export type DownloadStatus =
  | 'queued'      // Waiting in queue
  | 'preparing'   // Server preparing download
  | 'ready'       // Zip is ready, can start streaming
  | 'downloading' // Actively transferring
  | 'completed'   // Successfully finished
  | 'failed'      // Error occurred
  | 'cancelled';  // User cancelled

/**
 * A download item in the download queue.
 */
export interface DownloadItem {
  id: string;                    // Unique download ID
  nodeId: string;                // Target node
  sessionId: string;             // File browser session
  paths: string[];               // Files/folders to download
  filename: string;              // Output filename
  type: 'single' | 'zip';        // Download type
  status: DownloadStatus;        // Current status
  totalBytes: number | null;     // Total size (if known)
  transferredBytes: number;      // Bytes downloaded
  speed: number;                 // Current speed (bytes/sec)
  eta: number | null;            // Estimated time remaining (seconds)
  error: string | null;          // Error message if failed
  startedAt: string;             // Start timestamp
  completedAt: string | null;    // Completion timestamp
  /** Progress message for zip creation (e.g., "Compressing: 50%") */
  progressMessage?: string;
  /** Percentage complete for zip creation (0-100) */
  percentComplete?: number;
}

/**
 * Request to create a new download.
 */
export interface CreateDownloadRequest {
  sessionId: string;
  paths: string[];
  asZip?: boolean;
}

/**
 * Response from creating a download.
 */
export interface CreateDownloadResponse {
  downloadId: string;
  filename: string;
  totalBytes: number | null;
  status: string;
}

/**
 * Progress event for downloads sent via SignalR.
 */
export interface DownloadProgressEvent {
  downloadId: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBytesPerSec: number;
  estimatedSecondsRemaining: number | null;
  /** Progress message from agent (e.g., "Compressing: 50% (5/10 files)") */
  message?: string;
  /** Percentage complete for zip creation (0-100) */
  percentComplete?: number;
}

/**
 * Status change event for downloads sent via SignalR.
 */
export interface DownloadStatusChangedEvent {
  downloadId: string;
  status: DownloadStatus;
  error: string | null;
}

// ==========================================
// SSH File Download Types
// ==========================================

/**
 * Response from SSH download status check.
 */
export interface SshDownloadStatusResponse {
  available: boolean;
  nodeId: string | null;
  machineId: string | null;
  host: string | null;
  username: string | null;
  hasCredentials: boolean;
  authMode: string | null;
  message: string | null;
  error: string | null;
}

/**
 * Request for SSH file list.
 */
export interface SshFileListRequest {
  path: string;
  maxEntries?: number;
}

/**
 * Response from SSH file list.
 */
export interface SshFileListResponse {
  entries: SshFileEntry[];
  truncated: boolean;
}

/**
 * A file/directory entry returned by SSH file list.
 */
export interface SshFileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
  size: number | null;
  lastModified: string | null;
  permissions: string | null;
}

/**
 * Request for SSH zip download.
 */
export interface SshZipDownloadRequest {
  paths: string[];
}

// Note: SSH zip downloads are streamed directly as a zip payload (binary),
// not a JSON initiation response. See `downloadSshZip()` in `api.ts`.
