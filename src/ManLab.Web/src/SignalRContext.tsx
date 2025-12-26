/**
 * SignalR Context for real-time WebSocket communication.
 * Provides connection management and live updates for the dashboard.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  HubConnectionBuilder,
  HubConnection,
  LogLevel,
} from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import type { Node, NodeStatus } from './types';

/**
 * Connection state for the SignalR context.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * SignalR context value interface.
 */
interface SignalRContextValue {
  connection: HubConnection | null;
  connectionStatus: ConnectionStatus;
  error: Error | null;
}

const SignalRContext = createContext<SignalRContextValue | null>(null);

/**
 * Props for the SignalR provider component.
 */
interface SignalRProviderProps {
  children: ReactNode;
  hubUrl?: string;
}

/**
 * SignalR Provider component.
 * Manages the WebSocket connection and provides real-time updates.
 */
export function SignalRProvider({
  children,
  hubUrl = '/hubs/agent',
}: SignalRProviderProps) {
  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

  // Handle node status change events
  const handleNodeStatusChange = useCallback(
    (nodeId: string, status: string, lastSeen: string) => {
      // Update the nodes query cache
      queryClient.setQueryData<Node[]>(['nodes'], (oldNodes) => {
        if (!oldNodes) return oldNodes;
        return oldNodes.map((node) =>
          node.id === nodeId
            ? { ...node, status: status as NodeStatus, lastSeen }
            : node
        );
      });
    },
    [queryClient]
  );

  // Handle new node registration events
  const handleNodeRegistered = useCallback(
    (node: Node) => {
      queryClient.setQueryData<Node[]>(['nodes'], (oldNodes) => {
        if (!oldNodes) return [node];
        // Check if node already exists
        const existingIndex = oldNodes.findIndex((n) => n.id === node.id);
        if (existingIndex >= 0) {
          // Update existing node
          const updated = [...oldNodes];
          updated[existingIndex] = node;
          return updated;
        }
        // Add new node
        return [node, ...oldNodes];
      });
    },
    [queryClient]
  );

  // Handle telemetry updates
  const handleTelemetryUpdate = useCallback(
    (nodeId: string) => {
      // Invalidate telemetry query for this node to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['telemetry', nodeId] });
      
      // Update node's lastSeen in the cache
      queryClient.setQueryData<Node[]>(['nodes'], (oldNodes) => {
        if (!oldNodes) return oldNodes;
        return oldNodes.map((node) =>
          node.id === nodeId
            ? { ...node, lastSeen: new Date().toISOString(), status: 'Online' as NodeStatus }
            : node
        );
      });
    },
    [queryClient]
  );

  useEffect(() => {
    // Build the connection
    const newConnection = new HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff: 0s, 2s, 4s, 8s, 16s, then cap at 30s
          const delay = Math.min(
            1000 * Math.pow(2, retryContext.previousRetryCount),
            30000
          );
          return delay;
        },
      })
      .configureLogging(LogLevel.Information)
      .build();

    // Set up event handlers
    newConnection.onreconnecting((err) => {
      setConnectionStatus('reconnecting');
      if (err) {
        setError(new Error(err.message));
      }
    });

    newConnection.onreconnected(() => {
      setConnectionStatus('connected');
      setError(null);
      // Refetch all nodes after reconnection
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    });

    newConnection.onclose((err) => {
      setConnectionStatus('disconnected');
      if (err) {
        setError(new Error(err.message));
      }
    });

    // Register server-to-client event handlers
    newConnection.on('NodeStatusChanged', handleNodeStatusChange);
    newConnection.on('NodeRegistered', handleNodeRegistered);
    newConnection.on('TelemetryReceived', handleTelemetryUpdate);

    // Start the connection
    setConnectionStatus('connecting');
    newConnection
      .start()
      .then(() => {
        setConnectionStatus('connected');
        setError(null);
      })
      .catch((err) => {
        setConnectionStatus('disconnected');
        setError(err);
        console.error('SignalR connection error:', err);
      });

    setConnection(newConnection);

    // Cleanup on unmount
    return () => {
      newConnection.stop();
    };
  }, [hubUrl, queryClient, handleNodeStatusChange, handleNodeRegistered, handleTelemetryUpdate]);

  return (
    <SignalRContext.Provider value={{ connection, connectionStatus, error }}>
      {children}
    </SignalRContext.Provider>
  );
}

/**
 * Hook to access the SignalR context.
 * Throws an error if used outside of SignalRProvider.
 */
export function useSignalR(): SignalRContextValue {
  const context = useContext(SignalRContext);
  if (!context) {
    throw new Error('useSignalR must be used within a SignalRProvider');
  }
  return context;
}
