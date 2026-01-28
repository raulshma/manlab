/**
 * API client for ManLab Dashboard.
 * Provides functions for fetching data from the server REST API.
 */

import type {
  Node,
  Telemetry,
  TelemetryHistoryResponse,
  Command,
  NodeSetting,
  ServiceMonitorConfig,
  LogViewerPolicy,
  LogViewerSession,
  FileBrowserPolicy,
  FileBrowserSession,
  ScriptSummary,
  Script,
  ScriptRun,
  CreateScriptRunResponse,
  NetworkTelemetryPoint,
  PingTelemetryPoint,
  ServiceStatusSnapshot,
  SmartDriveSnapshot,
  GpuSnapshot,
  UpsSnapshot,
  AgentResourceUsage,
  OnboardingMachine,
  SshTestResponse,
  StartInstallResponse,
  StartUninstallResponse,
  UninstallPreviewResponse,
  AgentReleaseCatalogResponse,
  SaveCredentialsRequest,
  UpdateConfigurationRequest,
  SshAuthMode,
  LocalAgentStatus,
  LocalAgentInstallResponse,
  AgentConfiguration,
  LogReadResponse,
  LogTailResponse,
  FileBrowserListResponse,
  FileBrowserReadResponse,
  TerminalOpenResponse,
  TerminalInputResponse,
  TerminalCloseResponse,
  TerminalSessionResponse,
  CancelScriptRunResponse,
  AuditEvent,
  // Enhanced telemetry types
  NetworkTelemetry,
  EnhancedGpuTelemetry,
  ApplicationPerformanceTelemetry,
  // SSH file download types
  SshDownloadStatusResponse,
  SshFileListResponse,
  HttpMonitorConfig,
  HttpMonitorCheck,
  TrafficMonitorConfig,
  TrafficSample,
  MonitorJobSummary,
  ScheduledNetworkToolConfig,
  ProcessTelemetry,
  // System update types
  SystemUpdateSettings,
  SystemUpdateAvailability,
  SystemUpdateDetails,
  SystemUpdateHistory,
  SystemUpdateLog,
  CreateSystemUpdateRequest,
  // Auto-update types
  AutoUpdateSettings,
  UpdateAutoUpdateSettingsRequest,
  NodeAutoUpdateStatus,
} from "./types";

const API_BASE = "/api";
const TOKEN_KEY = "manlab:auth_token";

/**
 * Helper function to get auth headers for API requests.
 * Returns an object with Authorization header if a token exists.
 */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export const api = {
  get: async <T>(
    url: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`, {
      signal: options?.signal,
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(response.statusText);
    return { data: await response.json() };
  },
  post: async <T>(
    url: string,
    body?: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) throw new Error(response.statusText);
    // Handle empty response
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null };
  },
  put: async <T>(
    url: string,
    body?: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) throw new Error(response.statusText);
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null };
  },
  delete: async <T>(
    url: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`, {
      method: "DELETE",
      signal: options?.signal,
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(response.statusText);
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null };
  },
};

/**
 * Onboarding: suggests a server base URL that is reachable from the target machine.
 *
 * This is especially important in dev where the UI runs on a different origin (Vite dev server)
 * and `window.location.origin` would point to the UI, not the backend server.
 */
export interface SuggestedServerUrlsResponse {
  serverBaseUrl: string;
  allServerUrls: string[];
}

export async function fetchSuggestedServerBaseUrl(): Promise<SuggestedServerUrlsResponse> {
  const response = await fetch(
    `${API_BASE}/onboarding/suggested-server-base-url`
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch suggested server base URL: ${response.statusText}`
    );
  }
  const data = (await response.json()) as {
    serverBaseUrl?: string;
    ServerBaseUrl?: string;
    allServerUrls?: string[];
    AllServerUrls?: string[];
  };
  return {
    serverBaseUrl: (data.serverBaseUrl ?? data.ServerBaseUrl ?? "").toString(),
    allServerUrls: data.allServerUrls ?? data.AllServerUrls ?? [],
  };
}

/**
 * Fetches all registered device nodes.
 */
export async function fetchNodes(): Promise<Node[]> {
  const response = await fetch(`${API_BASE}/devices`);
  if (!response.ok) {
    throw new Error(`Failed to fetch nodes: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Deletes a specific node by ID.
 */
export async function deleteNode(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to delete node: ${response.statusText}`);
  }
}

/**
 * Requests an immediate ping from a specific agent.
 * If successful, the agent's heartbeat backoff will be reset.
 * @returns Promise resolving when the ping request is sent (not when a response is received)
 */
export async function requestAgentPing(nodeId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/ping`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    if (response.status === 503) {
      const data = await response.json();
      throw new Error(data.message || "Agent is not currently connected");
    }
    throw new Error(`Failed to request ping: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches a specific node by ID.
 */
export async function fetchNode(id: string): Promise<Node> {
  const response = await fetch(`${API_BASE}/devices/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to fetch node: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches telemetry history for a specific node.
 */
export async function fetchNodeTelemetry(
  id: string,
  count: number = 10
): Promise<Telemetry[]> {
  const response = await fetch(
    `${API_BASE}/devices/${id}/telemetry?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to fetch telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches telemetry history over a time range with rollups.
 */
export async function fetchNodeTelemetryHistory(
  id: string,
  params: {
    fromUtc: string;
    toUtc: string;
    resolution?: "auto" | "raw" | "hour" | "day";
  }
): Promise<TelemetryHistoryResponse> {
  const qs = new URLSearchParams({
    fromUtc: params.fromUtc,
    toUtc: params.toUtc,
  });
  if (params.resolution) {
    qs.set("resolution", params.resolution);
  }

  const response = await fetch(
    `${API_BASE}/devices/${id}/telemetry/history?${qs.toString()}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch telemetry history: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches network telemetry history for a node.
 */
export async function fetchNodeNetworkTelemetry(
  id: string,
  count: number = 120
): Promise<NetworkTelemetryPoint[]> {
  const response = await fetch(
    `${API_BASE}/devices/${id}/telemetry/network?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch network telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches ping telemetry history for a node.
 */
export async function fetchNodePingTelemetry(
  id: string,
  count: number = 120
): Promise<PingTelemetryPoint[]> {
  const response = await fetch(
    `${API_BASE}/devices/${id}/telemetry/ping?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch ping telemetry: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchServiceStatusHistory(
  nodeId: string,
  count: number = 200
): Promise<ServiceStatusSnapshot[]> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/service-status?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch service status: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchSmartHistory(
  nodeId: string,
  count: number = 200
): Promise<SmartDriveSnapshot[]> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/smart?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch SMART history: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchGpuHistory(
  nodeId: string,
  count: number = 500
): Promise<GpuSnapshot[]> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/gpus?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch GPU history: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchUpsHistory(
  nodeId: string,
  count: number = 500
): Promise<UpsSnapshot[]> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/ups?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch UPS history: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches agent resource usage history for a node.
 */
export async function fetchAgentResourceUsage(
  nodeId: string,
  count: number = 120
): Promise<AgentResourceUsage[]> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/agent-resources?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch agent resource usage: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches enhanced network telemetry for a node.
 */
export async function fetchEnhancedNetworkTelemetry(
  nodeId: string
): Promise<NetworkTelemetry | null> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/enhanced-network`
  );
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch enhanced network telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches enhanced GPU telemetry for a node.
 */
export async function fetchEnhancedGpuTelemetry(
  nodeId: string
): Promise<EnhancedGpuTelemetry[] | null> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/enhanced-gpu`
  );
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch enhanced GPU telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches APM telemetry for a node.
 */
export async function fetchApmTelemetry(
  nodeId: string
): Promise<ApplicationPerformanceTelemetry | null> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/apm`
  );
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch APM telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches the latest process telemetry for a node.
 */
export async function fetchProcessTelemetry(
  nodeId: string
): Promise<ProcessTelemetry[] | null> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/telemetry/processes`
  );
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch process telemetry: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches command history for a specific node.
 */
export async function fetchNodeCommands(
  id: string,
  count: number = 20
): Promise<Command[]> {
  const response = await fetch(
    `${API_BASE}/devices/${id}/commands?count=${count}`
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to fetch commands: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches per-node settings.
 */
export async function fetchNodeSettings(id: string): Promise<NodeSetting[]> {
  const response = await fetch(`${API_BASE}/devices/${id}/settings`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to fetch node settings: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: Service monitor config APIs
 */
export async function fetchServiceMonitorConfigs(nodeId: string): Promise<ServiceMonitorConfig[]> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/service-monitor-configs`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch service monitor configs: ${response.statusText}`);
  }
  return response.json();
}

export async function upsertServiceMonitorConfig(
  nodeId: string,
  configId: string | null,
  body: { serviceName?: string; enabled?: boolean }
): Promise<ServiceMonitorConfig> {
  const url = configId
    ? `${API_BASE}/devices/${nodeId}/service-monitor-configs/${configId}`
    : `${API_BASE}/devices/${nodeId}/service-monitor-configs`;
  const method = configId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to save service monitor config: ${await response.text()}`);
  }
  return response.json();
}

export async function deleteServiceMonitorConfig(nodeId: string, configId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/service-monitor-configs/${configId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");
    throw new Error(`Failed to delete service monitor config: ${response.statusText}`);
  }
}

export async function requestServiceStatusRefresh(nodeId: string): Promise<{ commandId: string }> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/service-monitor-configs/refresh`, {
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to request refresh: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: Log viewer policies + session
 */
export async function fetchLogViewerPolicies(nodeId: string): Promise<LogViewerPolicy[]> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/log-viewer-policies`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch log viewer policies: ${response.statusText}`);
  }
  return response.json();
}

export async function upsertLogViewerPolicy(
  nodeId: string,
  policyId: string | null,
  body: { displayName?: string; path?: string; maxBytesPerRequest?: number }
): Promise<LogViewerPolicy> {
  const url = policyId
    ? `${API_BASE}/devices/${nodeId}/log-viewer-policies/${policyId}`
    : `${API_BASE}/devices/${nodeId}/log-viewer-policies`;
  const method = policyId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");
    throw new Error(`Failed to save log viewer policy: ${await response.text()}`);
  }
  return response.json();
}

export async function deleteLogViewerPolicy(nodeId: string, policyId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/log-viewer-policies/${policyId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");
    throw new Error(`Failed to delete log viewer policy: ${response.statusText}`);
  }
}

export async function createLogViewerSession(
  nodeId: string,
  policyId: string,
  ttlSeconds?: number
): Promise<LogViewerSession> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/log-viewer-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyId, ttlSeconds }),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");

    // Surface server-provided error details (often includes why authorization failed).
    let details = "";
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        // Common shapes: { message }, string, or validation-ish objects.
        if (typeof json === "string") {
          details = json;
        } else if (json && typeof json === "object") {
          const obj = json as Record<string, unknown>;
          const msg = obj.message;
          details = typeof msg === "string" ? msg : JSON.stringify(json);
        }
      } else {
        details = await response.text();
      }
    } catch {
      // ignore
    }

    const suffix = details?.trim() ? `: ${details.trim()}` : "";
    throw new Error(`Failed to create log viewer session (${response.status} ${response.statusText})${suffix}`);
  }
  return response.json();
}

/**
 * Enhancements: File browser policies + session
 */
export async function fetchFileBrowserPolicies(nodeId: string): Promise<FileBrowserPolicy[]> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/file-browser-policies`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch file browser policies: ${response.statusText}`);
  }
  return response.json();
}

export async function upsertFileBrowserPolicy(
  nodeId: string,
  policyId: string | null,
  body: { displayName?: string; rootPath?: string; maxBytesPerRead?: number }
): Promise<FileBrowserPolicy> {
  const url = policyId
    ? `${API_BASE}/devices/${nodeId}/file-browser-policies/${policyId}`
    : `${API_BASE}/devices/${nodeId}/file-browser-policies`;
  const method = policyId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");
    throw new Error(`Failed to save file browser policy: ${await response.text()}`);
  }
  return response.json();
}

export async function deleteFileBrowserPolicy(nodeId: string, policyId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/file-browser-policies/${policyId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");
    throw new Error(`Failed to delete file browser policy: ${response.statusText}`);
  }
}

export async function createFileBrowserSession(
  nodeId: string,
  policyId: string,
  ttlSeconds?: number
): Promise<FileBrowserSession> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/file-browser-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyId, ttlSeconds }),
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error("Not found");

    let details = "";
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        if (typeof json === "string") {
          details = json;
        } else if (json && typeof json === "object") {
          const obj = json as Record<string, unknown>;
          const msg = obj.message;
          details = typeof msg === "string" ? msg : JSON.stringify(json);
        }
      } else {
        details = await response.text();
      }
    } catch {
      // ignore
    }

    const suffix = details?.trim() ? `: ${details.trim()}` : "";
    throw new Error(`Failed to create file browser session (${response.status} ${response.statusText})${suffix}`);
  }

  return response.json();
}

async function tryExtractErrorDetails(response: Response): Promise<string> {
  let details = "";
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      if (typeof json === "string") {
        details = json;
      } else if (json && typeof json === "object") {
        const obj = json as Record<string, unknown>;
        const msg = obj.message;
        details = typeof msg === "string" ? msg : JSON.stringify(json);
      }
    } else {
      details = await response.text();
    }
  } catch {
    // ignore
  }
  return details?.trim() ?? "";
}

/**
 * Enhancements: File browser - Create a full-system browsing session (no policy allowlist)
 */
export async function createSystemFileBrowserSession(
  nodeId: string,
  ttlSeconds?: number,
  maxBytesPerRead?: number
): Promise<Pick<FileBrowserSession, "sessionId" | "nodeId" | "rootPath" | "maxBytesPerRead" | "expiresAt">> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/file-browser-sessions/system`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttlSeconds, maxBytesPerRead }),
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");

    const details = await tryExtractErrorDetails(response);
    const suffix = details ? `: ${details}` : "";
    throw new Error(`Failed to create file browser session (${response.status} ${response.statusText})${suffix}`);
  }

  return response.json();
}

/**
 * Enhancements: Scripts + runs
 */
export async function fetchScripts(): Promise<ScriptSummary[]> {
  const response = await fetch(`${API_BASE}/scripts`);
  if (!response.ok) throw new Error(`Failed to fetch scripts: ${response.statusText}`);
  return response.json();
}

export async function fetchScript(id: string): Promise<Script> {
  const response = await fetch(`${API_BASE}/scripts/${id}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Script not found");
    throw new Error(`Failed to fetch script: ${response.statusText}`);
  }
  return response.json();
}

export async function createScript(body: {
  name: string;
  description?: string | null;
  shell: "Bash" | "PowerShell";
  content: string;
  isReadOnly?: boolean;
}): Promise<Script> {
  const response = await fetch(`${API_BASE}/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed to create script: ${await response.text()}`);
  return response.json();
}

export async function updateScript(id: string, body: Partial<{
  name: string;
  description: string | null;
  shell: "Bash" | "PowerShell";
  content: string;
  isReadOnly: boolean;
}>): Promise<Script> {
  const response = await fetch(`${API_BASE}/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed to update script: ${await response.text()}`);
  return response.json();
}

export async function deleteScript(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/scripts/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Failed to delete script: ${await response.text()}`);
}

export async function createScriptRun(nodeId: string, scriptId: string): Promise<CreateScriptRunResponse> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/script-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId }),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to create script run: ${await response.text()}`);
  }
  return response.json();
}

export async function cancelScriptRun(runId: string): Promise<CancelScriptRunResponse> {
  const response = await fetch(`${API_BASE}/script-runs/${runId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Script run not found");
    throw new Error(`Failed to cancel script run: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchScriptRuns(nodeId: string, count: number = 50): Promise<ScriptRun[]> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/script-runs?count=${count}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch script runs: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchScriptRun(runId: string): Promise<ScriptRun> {
  const response = await fetch(`${API_BASE}/script-runs/${runId}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Script run not found");
    throw new Error(`Failed to fetch script run: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Upserts one or more per-node settings.
 */
export async function upsertNodeSettings(
  nodeId: string,
  settings: Array<{ key: string; value: string | null; category?: string; description?: string | null }>
): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      settings.map((s) => ({
        key: s.key,
        value: s.value,
        category: s.category,
        description: s.description,
      }))
    ),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to update node settings: ${await response.text()}`);
  }
}

/**
 * Creates a new command for a node.
 */
export async function createCommand(
  nodeId: string,
  commandType: string,
  payload?: object
): Promise<Command> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      commandType,
      payload: payload ? JSON.stringify(payload) : null,
    }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(`Failed to create command: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Restarts a Docker container on a node.
 */
export async function restartContainer(
  nodeId: string,
  containerId: string
): Promise<Command> {
  return createCommand(nodeId, "docker.restart", { containerId });
}

/**
 * Starts a Docker container on a node.
 */
export async function startContainer(
  nodeId: string,
  containerId: string
): Promise<Command> {
  return createCommand(nodeId, "docker.start", { containerId });
}

/**
 * Stops a Docker container on a node.
 */
export async function stopContainer(
  nodeId: string,
  containerId: string
): Promise<Command> {
  return createCommand(nodeId, "docker.stop", { containerId });
}

/**
 * Inspects a Docker container on a node.
 */
export async function inspectContainer(
  nodeId: string,
  containerId: string
): Promise<Command> {
  return createCommand(nodeId, "docker.inspect", { containerId });
}

/**
 * Reads Docker logs for a container.
 */
export async function fetchContainerLogs(
  nodeId: string,
  input: {
    containerId: string;
    tail?: number;
    since?: string;
    timestamps?: boolean;
    maxBytes?: number;
  }
): Promise<Command> {
  return createCommand(nodeId, "docker.logs", input);
}

/**
 * Reads one-shot Docker stats for containers.
 */
export async function fetchContainerStats(
  nodeId: string,
  containerId?: string
): Promise<Command> {
  return createCommand(nodeId, "docker.stats", containerId ? { containerId } : undefined);
}

/**
 * Executes a command inside a container.
 */
export async function execInContainer(
  nodeId: string,
  input: {
    containerId: string;
    command: string[];
    workingDir?: string;
    user?: string;
    environment?: Record<string, string | null>;
  }
): Promise<Command> {
  return createCommand(nodeId, "docker.exec", input);
}

/**
 * Removes a Docker container.
 */
export async function removeContainer(
  nodeId: string,
  input: { containerId: string; force?: boolean; removeVolumes?: boolean }
): Promise<Command> {
  return createCommand(nodeId, "docker.remove", input);
}

/**
 * Lists Docker compose stacks on a node.
 */
export async function listComposeStacks(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "compose.list");
}

/**
 * Brings up a Docker compose stack.
 */
export async function composeUp(
  nodeId: string,
  input: {
    projectName: string;
    composeYaml: string;
    environment?: Record<string, string | null>;
    detach?: boolean;
    removeOrphans?: boolean;
    profiles?: string[];
  }
): Promise<Command> {
  return createCommand(nodeId, "compose.up", input);
}

/**
 * Brings down a Docker compose stack.
 */
export async function composeDown(
  nodeId: string,
  input: {
    projectName: string;
    composeYaml: string;
    environment?: Record<string, string | null>;
    removeOrphans?: boolean;
    volumes?: boolean;
    removeImages?: boolean;
  }
): Promise<Command> {
  return createCommand(nodeId, "compose.down", input);
}

/**
 * Triggers a system update on a node.
 */
export async function triggerSystemUpdate(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "system.update");
}

/**
 * Shuts down the system (the actual machine, not just the agent).
 * @param nodeId The node to shutdown.
 * @param delaySeconds Optional delay in seconds before shutdown (default: 0 = immediate).
 */
export async function shutdownSystem(
  nodeId: string,
  delaySeconds: number = 0
): Promise<Command> {
  return createCommand(nodeId, "system.shutdown", { delaySeconds });
}

/**
 * Restarts the system (the actual machine, not just the agent).
 * @param nodeId The node to restart.
 * @param delaySeconds Optional delay in seconds before restart (default: 0 = immediate).
 */
export async function restartSystem(
  nodeId: string,
  delaySeconds: number = 0
): Promise<Command> {
  return createCommand(nodeId, "system.restart", { delaySeconds });
}

/**
 * Requests a Docker container list from a node.
 * The server will dispatch this to the agent and store the output in the command log.
 */
export async function requestDockerContainerList(
  nodeId: string
): Promise<Command> {
  return createCommand(nodeId, "docker.list");
}

/**
 * Requests a graceful shutdown of the agent.
 * The agent will terminate and restart via its scheduled task.
 */
export async function shutdownAgent(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "agent.shutdown");
}

/**
 * Enables the agent's scheduled task (starts the agent on next trigger).
 */
export async function enableAgentTask(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "agent.enabletask");
}

/**
 * Disables the agent's scheduled task (prevents the agent from auto-starting).
 */
export async function disableAgentTask(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "agent.disabletask");
}

/**
 * Updates the agent's runtime configuration.
 * The agent will save changes to appsettings.json and restart to apply them.
 */
export async function updateAgentConfig(
  nodeId: string,
  config: Partial<AgentConfiguration>
): Promise<Command> {
  return createCommand(nodeId, "config.update", config);
}

/**
 * Sends a Wake-on-LAN magic packet to restart an offline node.
 * Requires the node to have a MAC address stored from a previous agent connection.
 */
export async function wakeNode(nodeId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/wake`, {
    method: "POST",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error("Node not found");
    }
    throw new Error(data.message || response.statusText);
  }
  return response.json();
}

/**
 * Onboarding: list all machines.
 */
export async function fetchOnboardingMachines(): Promise<OnboardingMachine[]> {
  const response = await fetch(`${API_BASE}/onboarding/machines`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch onboarding machines: ${response.statusText}`
    );
  }
  return response.json();
}

export async function createOnboardingMachine(input: {
  host: string;
  port: number;
  username: string;
  authMode: SshAuthMode;
  trustHostKey?: boolean;
  forceInstall?: boolean;
  runAsRoot?: boolean;
  serverBaseUrlOverride?: string | null;
}): Promise<OnboardingMachine> {
  const response = await fetch(`${API_BASE}/onboarding/machines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to create onboarding machine: ${await response.text()}`
    );
  }
  return response.json();
}

export async function deleteOnboardingMachine(
  machineId: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/onboarding/machines/${machineId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to delete onboarding machine: ${await response.text()}`
    );
  }
}

export async function cancelOnboardingMachine(
  machineId: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/onboarding/machines/${machineId}/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
     if (response.status === 404) {
        // Job might have already finished; treat as success or ignore.
        return;
     }
     throw new Error(`Failed to cancel onboarding: ${await response.text()}`);
  }
}

export async function testSshConnection(
  machineId: string,
  input: {
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
    trustHostKey: boolean;
    useSavedCredentials?: boolean;
  }
): Promise<SshTestResponse> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/ssh/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`SSH test failed: ${await response.text()}`);
  }
  return response.json();
}

export async function installAgent(
  machineId: string,
  input: {
    serverBaseUrl: string;
    force: boolean;
    runAsRoot?: boolean;
    trustHostKey: boolean;
    targetNodeId?: string;
    agentSource?: "local" | "github";
    agentChannel?: string;
    agentVersion?: string;
    gitHubReleaseBaseUrl?: string;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
    useSavedCredentials?: boolean;
  }
): Promise<StartInstallResponse> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/install`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`Install start failed: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchAgentReleaseCatalog(channel?: string): Promise<AgentReleaseCatalogResponse> {
  const url = new URL(`${API_BASE}/binaries/agent/release-catalog`, window.location.origin);
  if (channel) {
    url.searchParams.set("channel", channel);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch agent release catalog: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchOnboardingMachineForNode(nodeId: string): Promise<OnboardingMachine> {
  const response = await fetch(`${API_BASE}/onboarding/nodes/${nodeId}/machine`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No onboarding machine is linked to this node.");
    }
    throw new Error(`Failed to fetch linked machine: ${await response.text()}`);
  }
  return response.json();
}

export async function uninstallAgent(
  machineId: string,
  input: {
    serverBaseUrl: string;
    trustHostKey: boolean;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
    useSavedCredentials?: boolean;
  }
): Promise<StartUninstallResponse> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/uninstall`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`Uninstall start failed: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Onboarding: Save encrypted credentials for a machine.
 * If rememberCredentials is false, clears saved credentials.
 */
export async function saveMachineCredentials(
  machineId: string,
  input: SaveCredentialsRequest
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/credentials`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to save credentials: ${await response.text()}`);
  }
}

/**
 * Onboarding: Clear saved credentials for a machine.
 */
export async function clearMachineCredentials(
  machineId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/credentials`,
    {
      method: "DELETE",
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to clear credentials: ${await response.text()}`);
  }
}

/**
 * Onboarding: Update configuration preferences for a machine.
 */
export async function updateMachineConfiguration(
  machineId: string,
  input: UpdateConfigurationRequest
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/configuration`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to update configuration: ${await response.text()}`);
  }
}

export async function fetchUninstallPreview(
  machineId: string,
  input: {
    serverBaseUrl: string;
    trustHostKey: boolean;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
    useSavedCredentials?: boolean;
  }
): Promise<UninstallPreviewResponse> {
  const response = await fetch(
    `${API_BASE}/onboarding/machines/${machineId}/uninstall/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    throw new Error(`Uninstall preview failed: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Local Agent: Fetches the status of the local agent installation on the server.
 */
export async function fetchLocalAgentStatus(): Promise<LocalAgentStatus> {
  const response = await fetch(`${API_BASE}/localagent/status`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch local agent status: ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Local Agent: Fetches the default agent configuration values.
 */
export async function fetchDefaultAgentConfig(): Promise<AgentConfiguration> {
  const response = await fetch(`${API_BASE}/localagent/default-config`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch default agent config: ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Local Agent: Triggers installation of the agent on the server machine.
 * @param force If true, reinstall even if already installed.
 * @param userMode If true, install to user-local directory without admin privileges.
 * @param agentConfig Optional agent configuration overrides.
 */
export async function installLocalAgent(
  force: boolean = false,
  userMode: boolean = false,
  agentConfig?: Partial<AgentConfiguration>
): Promise<LocalAgentInstallResponse> {
  const response = await fetch(`${API_BASE}/localagent/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({
      force,
      userMode,
      agentConfig: agentConfig ? agentConfig : undefined
    }),
  });
  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    return { started: false, error: errorData.error ?? response.statusText };
  }
  return response.json();
}

/**
 * Local Agent: Triggers uninstallation of the agent from the server machine.
 * The server will automatically detect the correct install mode to use.
 */
export async function uninstallLocalAgent(): Promise<LocalAgentInstallResponse> {
  const response = await fetch(`${API_BASE}/localagent/uninstall`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    return { started: false, error: errorData.error ?? response.statusText };
  }
  return response.json();
}

/**
 * Local Agent: Clears leftover agent files from the server machine.
 */
export async function clearLocalAgentFiles(): Promise<LocalAgentInstallResponse> {
  const response = await fetch(`${API_BASE}/localagent/clear-files`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    return { started: false, error: errorData.error ?? response.statusText };
  }
  return response.json();
}

/**
 * Enhancements: Log viewer - Read log content via session
 */
export async function readLogContent(
  nodeId: string,
  sessionId: string,
  offsetBytes?: number,
  maxBytes?: number
): Promise<LogReadResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/log-viewer-sessions/${sessionId}/read`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offsetBytes, maxBytes }),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    if (response.status === 504) throw new Error("Timed out waiting for agent response");
    throw new Error(`Failed to read log: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: Log viewer - Tail log content via session
 */
export async function tailLogContent(
  nodeId: string,
  sessionId: string,
  maxBytes?: number,
  durationSeconds?: number
): Promise<LogTailResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/log-viewer-sessions/${sessionId}/tail`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxBytes, durationSeconds }),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    if (response.status === 504) throw new Error("Timed out waiting for agent response");
    throw new Error(`Failed to tail log: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: File browser - List directory via session
 */
export async function listFileBrowserEntries(
  nodeId: string,
  sessionId: string,
  path?: string,
  maxEntries?: number
): Promise<FileBrowserListResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/file-browser-sessions/${sessionId}/list`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, maxEntries }),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    if (response.status === 504) throw new Error("Timed out waiting for agent response");
    throw new Error(`Failed to list directory: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: File browser - Read file via session
 */
export async function readFileBrowserContent(
  nodeId: string,
  sessionId: string,
  path: string,
  maxBytes?: number,
  offset?: number
): Promise<FileBrowserReadResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/file-browser-sessions/${sessionId}/read`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, maxBytes, offset }),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    if (response.status === 504) throw new Error("Timed out waiting for agent response");
    throw new Error(`Failed to read file: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Server: Activity/audit events
 */
export interface FetchAuditEventsParams {
  fromUtc?: string;
  toUtc?: string;
  kind?: string;
  category?: string;
  eventName?: string;
  nodeId?: string;
  commandId?: string;
  machineId?: string;
  take?: number;
}

export async function fetchAuditEvents(params?: FetchAuditEventsParams): Promise<AuditEvent[]> {
  const qs = new URLSearchParams();

  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  };

  add("fromUtc", params?.fromUtc);
  add("toUtc", params?.toUtc);
  add("kind", params?.kind);
  add("category", params?.category);
  add("eventName", params?.eventName);
  add("nodeId", params?.nodeId);
  add("commandId", params?.commandId);
  add("machineId", params?.machineId);
  if (params?.take !== undefined) {
    add("take", Math.max(1, Math.min(2000, Math.floor(params.take))));
  }

  const url = `${API_BASE}/audit-events${qs.size ? `?${qs.toString()}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audit events: ${response.statusText}`);
  }

  return response.json();
}

// ==========================================
// Monitoring (Quartz jobs + HTTP health + traffic)
// ==========================================

export async function fetchMonitorJobs(): Promise<MonitorJobSummary[]> {
  const response = await fetch(`${API_BASE}/monitoring/jobs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch monitor jobs: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchHttpMonitors(): Promise<HttpMonitorConfig[]> {
  const response = await fetch(`${API_BASE}/monitoring/http`);
  if (!response.ok) {
    throw new Error(`Failed to fetch HTTP monitors: ${response.statusText}`);
  }
  return response.json();
}

export async function createHttpMonitor(body: {
  name: string;
  url: string;
  method?: string | null;
  expectedStatus?: number | null;
  bodyContains?: string | null;
  timeoutMs?: number | null;
  cron: string;
  enabled?: boolean | null;
}): Promise<HttpMonitorConfig> {
  const response = await fetch(`${API_BASE}/monitoring/http`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function updateHttpMonitor(
  id: string,
  body: {
    name: string;
    url: string;
    method?: string | null;
    expectedStatus?: number | null;
    bodyContains?: string | null;
    timeoutMs?: number | null;
    cron: string;
    enabled?: boolean | null;
  }
): Promise<HttpMonitorConfig> {
  const response = await fetch(`${API_BASE}/monitoring/http/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function deleteHttpMonitor(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/http/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to delete HTTP monitor: ${response.statusText}`);
  }
}

export async function runHttpMonitor(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/http/${id}/run`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to run HTTP monitor: ${response.statusText}`);
  }
}

export async function fetchHttpMonitorHistory(id: string, count: number = 200): Promise<HttpMonitorCheck[]> {
  const response = await fetch(`${API_BASE}/monitoring/http/${id}/history?count=${count}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch HTTP monitor history: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchTrafficMonitorConfig(): Promise<TrafficMonitorConfig | null> {
  const response = await fetch(`${API_BASE}/monitoring/traffic/config`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch traffic monitor config: ${response.statusText}`);
  }
  return response.json();
}

export async function updateTrafficMonitorConfig(body: {
  cron: string;
  enabled?: boolean | null;
  interfaceName?: string | null;
}): Promise<TrafficMonitorConfig> {
  const response = await fetch(`${API_BASE}/monitoring/traffic/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function deleteTrafficMonitorConfig(): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/traffic/config`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete traffic monitor config: ${response.statusText}`);
  }
}

export async function fetchTrafficSamples(count: number = 360, interfaceName?: string): Promise<TrafficSample[]> {
  const params = new URLSearchParams({ count: String(count) });
  if (interfaceName) {
    params.set("interfaceName", interfaceName);
  }
  const response = await fetch(`${API_BASE}/monitoring/traffic/history?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch traffic samples: ${response.statusText}`);
  }
  return response.json();
}

export async function runTrafficMonitor(): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/traffic/run`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to run traffic monitor: ${response.statusText}`);
  }
}

// Network Tools Scheduled Configs
export async function fetchScheduledNetworkTools(): Promise<ScheduledNetworkToolConfig[]> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools`);
  if (!response.ok) {
    throw new Error(`Failed to fetch scheduled network tools: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchScheduledNetworkTool(id: string): Promise<ScheduledNetworkToolConfig> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch scheduled network tool: ${response.statusText}`);
  }
  return response.json();
}

export async function createScheduledNetworkTool(body: {
  name: string;
  toolType: string;
  target?: string | null;
  parameters?: string | null;
  cron: string;
  enabled?: boolean | null;
}): Promise<ScheduledNetworkToolConfig> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function updateScheduledNetworkTool(
  id: string,
  body: {
    name: string;
    toolType: string;
    target?: string | null;
    parameters?: string | null;
    cron: string;
    enabled?: boolean | null;
  }
): Promise<ScheduledNetworkToolConfig> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function deleteScheduledNetworkTool(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to delete scheduled network tool: ${response.statusText}`);
  }
}

export async function runScheduledNetworkTool(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/monitoring/network-tools/${id}/run`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to run scheduled network tool: ${response.statusText}`);
  }
}

// Global Job Management (agent-update, system-update)
export async function updateGlobalJobSchedule(
  jobType: "agent-update" | "system-update",
  cronExpression: string
): Promise<{ message: string; schedule: string }> {
  const response = await fetch(`${API_BASE}/monitoring/jobs/global/${jobType}/schedule`, {
    method: "PUT",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ cronExpression }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Failed to update ${jobType} schedule`);
  }
  return response.json();
}

export async function updateGlobalJobEnabled(
  jobType: "agent-update" | "system-update",
  enabled: boolean
): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/monitoring/jobs/global/${jobType}/enabled`, {
    method: "PUT",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Failed to update ${jobType} enabled state`);
  }
  return response.json();
}

export async function triggerGlobalJob(
  jobType: "agent-update" | "system-update"
): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/monitoring/jobs/global/${jobType}/trigger`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Failed to trigger ${jobType}`);
  }
  return response.json();
}

/**
 * Enhancements: Terminal - Open a new terminal session
 */
export async function openTerminalSession(
  nodeId: string,
  ttlSeconds?: number
): Promise<TerminalOpenResponse> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/terminal/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttlSeconds }),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to open terminal: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Enhancements: Terminal - Send input to a terminal session
 */
export async function sendTerminalInput(
  nodeId: string,
  sessionId: string,
  input: string
): Promise<TerminalInputResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/terminal/${sessionId}/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    throw new Error(`Failed to send input: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: Terminal - Close a terminal session
 */
export async function closeTerminalSession(
  nodeId: string,
  sessionId: string
): Promise<TerminalCloseResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/terminal/${sessionId}/close`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    throw new Error(`Failed to close terminal: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Enhancements: Terminal - Get terminal session status
 */
export async function getTerminalSession(
  nodeId: string,
  sessionId: string
): Promise<TerminalSessionResponse> {
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/terminal/${sessionId}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Session not found or expired");
    throw new Error(`Failed to get terminal session: ${response.statusText}`);
  }
  return response.json();
}



// ==========================================
// SSH File Download API
// ==========================================

/**
 * Checks if SSH download is available for a node.
 * Returns status including whether credentials are stored from onboarding.
 */
export async function fetchSshDownloadStatus(nodeId: string): Promise<SshDownloadStatusResponse> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/ssh-download/status`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to check SSH download status: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Lists files/directories via SSH/SFTP using stored onboarding credentials.
 * @param nodeId The node ID
 * @param path Virtual path to list (use "/" for root)
 * @param maxEntries Optional maximum number of entries to return
 */
export async function listSshFiles(
  nodeId: string,
  path: string,
  maxEntries?: number
): Promise<SshFileListResponse> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/ssh-file-browser/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, maxEntries }),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found or no SSH credentials");
    if (response.status === 503) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "SSH connection failed");
    }
    throw new Error(`Failed to list files via SSH: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Downloads a single file via SSH/SFTP.
 * Returns a Response object for streaming the file content.
 * @param nodeId The node ID
 * @param path Virtual path of the file to download
 */
export async function downloadSshFile(
  nodeId: string,
  path: string
): Promise<Response> {
  const encodedPath = encodeURIComponent(path);
  const response = await fetch(
    `${API_BASE}/devices/${nodeId}/ssh-download/file?path=${encodedPath}`
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("File not found or no SSH credentials");
    if (response.status === 503) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "SSH connection failed");
    }
    throw new Error(`Failed to download file via SSH: ${response.statusText}`);
  }
  return response;
}

/**
 * Downloads multiple files/directories as a zip via SSH/SFTP.
 * NOTE: The server streams the zip payload directly (application/zip).
 * @param nodeId The node ID
 * @param paths Array of virtual paths to include in the zip
 */
export async function downloadSshZip(
  nodeId: string,
  paths: string[]
): Promise<Response> {
  const response = await fetch(`${API_BASE}/devices/${nodeId}/ssh-download/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found or no SSH credentials");
    if (response.status === 503) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "SSH connection failed");
    }
    throw new Error(`Failed to start zip download via SSH: ${response.statusText}`);
  }
  return response;
}

/**
 * Gets the auto-update settings for a specific node.
 */
export async function fetchAutoUpdateSettings(nodeId: string): Promise<AutoUpdateSettings> {
  const response = await fetch(`${API_BASE}/autoupdate/${nodeId}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch auto-update settings: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Updates the auto-update settings for a specific node.
 */
export async function updateAutoUpdateSettings(
  nodeId: string,
  settings: UpdateAutoUpdateSettingsRequest
): Promise<void> {
  const response = await fetch(`${API_BASE}/autoupdate/${nodeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed to update auto-update settings: ${response.statusText}`);
  }
}

/**
 * Manually triggers an update check for a specific node.
 */
export async function triggerAutoUpdateCheck(nodeId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/autoupdate/${nodeId}/check`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed to trigger update check: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Approves a pending update for a specific node.
 */
export async function approvePendingUpdate(nodeId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/autoupdate/${nodeId}/approve`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed to approve pending update: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Disables auto-update for a specific node.
 */
export async function disableAutoUpdate(nodeId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/autoupdate/${nodeId}/disable`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to disable auto-update: ${response.statusText}`);
  }
}

/**
 * Triggers a global auto-update check for all nodes.
 */
export async function triggerGlobalAutoUpdateCheck(): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/autoupdate/trigger-global`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to trigger global update check: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Gets the status of all nodes with auto-update enabled.
 */
export async function fetchAutoUpdateStatus(): Promise<NodeAutoUpdateStatus[]> {
  const response = await fetch(`${API_BASE}/autoupdate/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch auto-update status: ${response.statusText}`);
  }
  return response.json();
}

// ============================================================================
// System Update API Functions
// ============================================================================

/**
 * Gets system update settings for a node.
 */
export async function fetchSystemUpdateSettings(nodeId: string): Promise<SystemUpdateSettings> {
  const response = await fetch(`${API_BASE}/systemupdate/${nodeId}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to fetch system update settings: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Updates system update settings for a node.
 */
export async function updateSystemUpdateSettings(
  nodeId: string,
  settings: SystemUpdateSettings
): Promise<void> {
  const response = await fetch(`${API_BASE}/systemupdate/${nodeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update system update settings: ${response.statusText}`);
  }
}

/**
 * Checks for available system updates on a node.
 */
export async function checkSystemUpdates(nodeId: string): Promise<SystemUpdateAvailability> {
  const response = await fetch(`${API_BASE}/systemupdate/${nodeId}/check`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to check for system updates: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Creates a pending system update.
 */
export async function createSystemUpdate(
  nodeId: string,
  options: CreateSystemUpdateRequest
): Promise<{ updateId: string }> {
  const response = await fetch(`${API_BASE}/systemupdate/${nodeId}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to create system update: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Gets details of a specific system update.
 */
export async function getSystemUpdateDetails(updateId: string): Promise<SystemUpdateDetails> {
  const response = await fetch(`${API_BASE}/systemupdate/updates/${updateId}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Update not found");
    throw new Error(`Failed to get update details: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Approves and executes a pending system update.
 */
export async function approveSystemUpdate(updateId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/systemupdate/updates/${updateId}/approve`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Update not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to approve update: ${response.statusText}`);
  }
}

/**
 * Rejects a pending system update.
 */
export async function rejectSystemUpdate(updateId: string, reason?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/systemupdate/updates/${updateId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Update not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to reject update: ${response.statusText}`);
  }
}

/**
 * Gets system update history for a node.
 */
export async function getSystemUpdateHistory(nodeId: string, limit = 50): Promise<SystemUpdateHistory[]> {
  const response = await fetch(`${API_BASE}/systemupdate/${nodeId}/history?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Node not found");
    throw new Error(`Failed to get update history: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Gets detailed logs for a system update.
 */
export async function getSystemUpdateLogs(updateId: string): Promise<SystemUpdateLog[]> {
  const response = await fetch(`${API_BASE}/systemupdate/updates/${updateId}/logs`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to get update logs: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Approves and executes a reboot for an update that requires it.
 */
export async function approveSystemReboot(updateId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/systemupdate/updates/${updateId}/reboot/approve`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Update not found");
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to approve reboot: ${response.statusText}`);
  }
}
