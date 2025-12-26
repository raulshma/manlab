/**
 * API client for ManLab Dashboard.
 * Provides functions for fetching data from the server REST API.
 */

import type { Node, Telemetry } from './types';

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
