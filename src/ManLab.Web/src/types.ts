/**
 * TypeScript types matching server DTOs for the ManLab Dashboard.
 */

/**
 * Node status enum matching server-side enum.
 */
export type NodeStatus = 'Online' | 'Offline' | 'Maintenance';

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
  lastSeen: string;
  status: NodeStatus;
  createdAt: string;
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
export type CommandExecutionStatus = 'Queued' | 'InProgress' | 'Success' | 'Failed';

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
}

export interface SshTestResponse {
  success: boolean;
  hostKeyFingerprint: string | null;
  requiresHostKeyTrust: boolean;
  whoAmI: string | null;
  osHint: string | null;
  error: string | null;
}

export interface StartInstallResponse {
  machineId: string;
  status: OnboardingStatus;
}

export interface StartUninstallResponse {
  machineId: string;
  status: OnboardingStatus;
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
}

