/**
 * API client for ManLab Dashboard.
 * Provides functions for fetching data from the server REST API.
 */

import type {
  Node,
  Telemetry,
  Command,
  OnboardingMachine,
  SshTestResponse,
  StartInstallResponse,
  StartUninstallResponse,
  SshAuthMode,
  LocalAgentStatus,
  LocalAgentInstallResponse,
} from "./types";

const API_BASE = "/api";

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
  return createCommand(nodeId, "DockerRestart", { containerId });
}

/**
 * Triggers a system update on a node.
 */
export async function triggerSystemUpdate(nodeId: string): Promise<Command> {
  return createCommand(nodeId, "Update");
}

/**
 * Requests a Docker container list from a node.
 * The server will dispatch this to the agent and store the output in the command log.
 */
export async function requestDockerContainerList(
  nodeId: string
): Promise<Command> {
  return createCommand(nodeId, "DockerList");
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
 * Local Agent: Triggers installation of the agent on the server machine.
 * @param force If true, reinstall even if already installed.
 * @param userMode If true, install to user-local directory without admin privileges.
 */
export async function installLocalAgent(
  force: boolean = false,
  userMode: boolean = false
): Promise<LocalAgentInstallResponse> {
  const response = await fetch(`${API_BASE}/localagent/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force, userMode }),
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
