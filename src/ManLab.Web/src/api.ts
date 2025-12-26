/**
 * API client for ManLab Dashboard.
 * Provides functions for fetching data from the server REST API.
 */

import type { Node, Telemetry, Command, OnboardingMachine, SshTestResponse, StartInstallResponse, StartUninstallResponse, SshAuthMode } from './types';

const API_BASE = '/api';

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
 * Fetches a specific node by ID.
 */
export async function fetchNode(id: string): Promise<Node> {
  const response = await fetch(`${API_BASE}/devices/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Node not found');
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
  const response = await fetch(`${API_BASE}/devices/${id}/telemetry?count=${count}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Node not found');
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
  const response = await fetch(`${API_BASE}/devices/${id}/commands?count=${count}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Node not found');
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
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      commandType,
      payload: payload ? JSON.stringify(payload) : null,
    }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Node not found');
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
  return createCommand(nodeId, 'DockerRestart', { containerId });
}

/**
 * Triggers a system update on a node.
 */
export async function triggerSystemUpdate(nodeId: string): Promise<Command> {
  return createCommand(nodeId, 'Update');
}

/**
 * Onboarding: list all machines.
 */
export async function fetchOnboardingMachines(): Promise<OnboardingMachine[]> {
  const response = await fetch(`${API_BASE}/onboarding/machines`);
  if (!response.ok) {
    throw new Error(`Failed to fetch onboarding machines: ${response.statusText}`);
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Failed to create onboarding machine: ${await response.text()}`);
  }
  return response.json();
}

export async function testSshConnection(machineId: string, input: {
  password?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
  trustHostKey: boolean;
}): Promise<SshTestResponse> {
  const response = await fetch(`${API_BASE}/onboarding/machines/${machineId}/ssh/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`SSH test failed: ${await response.text()}`);
  }
  return response.json();
}

export async function installAgent(machineId: string, input: {
  serverBaseUrl: string;
  force: boolean;
  trustHostKey: boolean;
  password?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
}): Promise<StartInstallResponse> {
  const response = await fetch(`${API_BASE}/onboarding/machines/${machineId}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Install start failed: ${await response.text()}`);
  }
  return response.json();
}

export async function uninstallAgent(machineId: string, input: {
  serverBaseUrl: string;
  trustHostKey: boolean;
  password?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
}): Promise<StartUninstallResponse> {
  const response = await fetch(`${API_BASE}/onboarding/machines/${machineId}/uninstall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Uninstall start failed: ${await response.text()}`);
  }
  return response.json();
}
