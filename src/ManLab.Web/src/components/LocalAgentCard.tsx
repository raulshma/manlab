/**
 * LocalAgentCard component for managing the local agent installation on the server.
 * Provides install/uninstall buttons and shows real-time logs.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLocalAgentStatus, installLocalAgent, uninstallLocalAgent } from '../api';
import { useSignalR } from '../SignalRContext';
import type { LocalAgentStatus } from '../types';
import { ConfirmationModal } from './ConfirmationModal';

const LOCAL_MACHINE_ID = '00000000-0000-0000-0000-000000000001';

interface LogEntry {
  timestamp: string;
  message: string;
}

export function LocalAgentCard() {
  const queryClient = useQueryClient();
  const { connection, connectionStatus } = useSignalR();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const { data: status, isLoading, error } = useQuery<LocalAgentStatus>({
    queryKey: ['localAgentStatus'],
    queryFn: fetchLocalAgentStatus,
    refetchInterval: 5000,
  });

  // Subscribe to local agent SignalR events
  const handleLog = useCallback((machineId: string, timestamp: string, message: string) => {
    if (machineId === LOCAL_MACHINE_ID) {
      setLogs((prev) => [...prev, { timestamp, message }].slice(-100));
      setShowLogs(true);
    }
  }, []);

  const handleStatusChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['localAgentStatus'] });
  }, [queryClient]);

  useEffect(() => {
    if (connection && connectionStatus === 'connected') {
      connection.on('LocalAgentLog', handleLog);
      connection.on('LocalAgentStatusChanged', handleStatusChanged);

      return () => {
        connection.off('LocalAgentLog', handleLog);
        connection.off('LocalAgentStatusChanged', handleStatusChanged);
      };
    }
  }, [connection, connectionStatus, handleLog, handleStatusChanged]);

  const installMutation = useMutation({
    mutationFn: (force: boolean) => installLocalAgent(force),
    onSuccess: () => {
      setLogs([]);
      queryClient.invalidateQueries({ queryKey: ['localAgentStatus'] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => uninstallLocalAgent(),
    onSuccess: () => {
      setLogs([]);
      queryClient.invalidateQueries({ queryKey: ['localAgentStatus'] });
    },
  });

  if (isLoading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-700 rounded-full"></div>
          <div className="h-4 bg-slate-700 rounded w-32"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-5">
        <p className="text-red-400 text-sm">Failed to load local agent status</p>
      </div>
    );
  }

  if (!status?.isSupported) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <span className="text-sm">Local agent not supported on this platform</span>
        </div>
      </div>
    );
  }

  const isOperationRunning = status.currentOperation != null;
  const statusColor = status.isRunning 
    ? 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30' 
    : status.isInstalled 
      ? 'text-amber-400 bg-amber-500/20 border-amber-500/30' 
      : 'text-slate-400 bg-slate-500/20 border-slate-500/30';

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-semibold">Local Server Agent</h3>
            <p className="text-slate-400 text-sm">Monitor this server machine</p>
          </div>
        </div>
        
        <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${statusColor}`}>
          {status.status}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        {!status.isInstalled && (
          <ConfirmationModal
            title="Install Local Agent"
            message="This will install the ManLab agent on this server machine, allowing you to monitor the server itself. The agent will run as a scheduled task."
            confirmText="Install"
            onConfirm={() => installMutation.mutate(false)}
            trigger={
              <Button
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg 
                          transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isOperationRunning || installMutation.isPending}
              >
                {installMutation.isPending ? 'Installing...' : 'Install Agent'}
              </Button>
            }
          />
        )}

        {status.isInstalled && (
          <>
            <ConfirmationModal
              title="Reinstall Local Agent"
              message="This will reinstall the ManLab agent, replacing any existing installation. The agent configuration will be reset."
              confirmText="Reinstall"
              onConfirm={() => installMutation.mutate(true)}
              trigger={
                <Button
                  className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg 
                            transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isOperationRunning || installMutation.isPending}
                >
                  Reinstall
                </Button>
              }
            />
            <ConfirmationModal
              title="Uninstall Local Agent"
              message="This will remove the ManLab agent from this server. You will no longer be able to monitor this machine until you reinstall the agent."
              confirmText="Uninstall"
              isDestructive={true}
              onConfirm={() => uninstallMutation.mutate()}
              trigger={
                <Button
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg 
                            transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isOperationRunning || uninstallMutation.isPending}
                >
                  {uninstallMutation.isPending ? 'Removing...' : 'Uninstall'}
                </Button>
              }
            />
          </>
        )}
      </div>

      {/* Linked Node */}
      {status.linkedNodeId && (
        <div className="mb-4 p-3 bg-slate-700/50 rounded-lg">
          <span className="text-slate-400 text-sm">Linked Node: </span>
          <a 
            href={`/nodes/${status.linkedNodeId}`}
            className="text-blue-400 hover:text-blue-300 text-sm font-mono"
          >
            {status.linkedNodeId.substring(0, 8)}...
          </a>
        </div>
      )}

      {/* Logs Toggle */}
      <button
        onClick={() => setShowLogs(!showLogs)}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-300 text-sm transition-colors"
      >
        <svg 
          className={`w-4 h-4 transition-transform ${showLogs ? 'rotate-90' : ''}`} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {showLogs ? 'Hide' : 'Show'} Installation Logs ({logs.length})
      </button>

      {/* Logs */}
      {showLogs && logs.length > 0 && (
        <div className="mt-3 p-3 bg-slate-900 rounded-lg max-h-48 overflow-y-auto font-mono text-xs">
          {logs.map((log, i) => (
            <div key={i} className={`${log.message.includes('ERROR') ? 'text-red-400' : 'text-slate-300'}`}>
              <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
              {' '}
              {log.message}
            </div>
          ))}
        </div>
      )}

      {/* Error Display */}
      {(installMutation.error || uninstallMutation.error) && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-red-400 text-sm">
            {installMutation.error?.message || uninstallMutation.error?.message}
          </p>
        </div>
      )}
    </div>
  );
}
