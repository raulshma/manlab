/**
 * API client for ManLab Dashboard.
 * Provides functions for fetching data from the server REST API.
 */

import type {
  Node,
  Telemetry,
  Command,
  NodeSetting,
  ServiceMonitorConfig,
  LogViewerPolicy,
  LogViewerSession,
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
  OnboardingMachine,
  SshTestResponse,
  StartInstallResponse,
  StartUninstallResponse,
  UninstallPreviewResponse,
  SshAuthMode,
  LocalAgentStatus,
  LocalAgentInstallResponse,
  AgentConfiguration,
  LogReadResponse,
  LogTailResponse,
  TerminalOpenResponse,
  TerminalInputResponse,
  TerminalCloseResponse,
  TerminalSessionResponse,
  CancelScriptRunResponse,
} from "./types";

const API_BASE = "/api";

export const api = {
  get: async <T>(url: string): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`);
    if (!response.ok) throw new Error(response.statusText);
    return { data: await response.json() };
  },
  post: async <T>(url: string, body?: unknown): Promise<{ data: T }> => {
    const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url.replace("/api", "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(response.statusText);
    // Handle empty response
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
export async function fetchSuggestedServerBaseUrl(): Promise<string> {
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
  };
  return (data.serverBaseUrl ?? data.ServerBaseUrl ?? "").toString();
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

export async function testSshConnection(
  machineId: string,
  input: {
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
    trustHostKey: boolean;
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
    trustHostKey: boolean;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
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

export async function uninstallAgent(
  machineId: string,
  input: {
    serverBaseUrl: string;
    trustHostKey: boolean;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
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

export async function fetchUninstallPreview(
  machineId: string,
  input: {
    serverBaseUrl: string;
    trustHostKey: boolean;
    password?: string;
    privateKeyPem?: string;
    privateKeyPassphrase?: string;
    sudoPassword?: string;
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
  const response = await fetch(`${API_BASE}/localagent/status`);
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
  const response = await fetch(`${API_BASE}/localagent/default-config`);
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
