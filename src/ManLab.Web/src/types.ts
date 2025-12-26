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
