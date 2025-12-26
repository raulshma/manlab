/**
 * LocalAgentCard component for managing the local agent installation on the server.
 * Provides install/uninstall buttons and shows real-time logs.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLocalAgentStatus, installLocalAgent, uninstallLocalAgent } from '../api';
import { useSignalR } from '../SignalRContext';
import type { LocalAgentStatus } from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { ChevronRight, Server } from 'lucide-react';

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
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse flex items-center gap-3">
            <div className="w-8 h-8 bg-muted rounded-full"></div>
            <div className="h-4 bg-muted rounded w-32"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load local agent status</AlertDescription>
      </Alert>
    );
  }

  if (!status?.isSupported) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span className="text-sm">Local agent not supported on this platform</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isOperationRunning = status.currentOperation != null;
  const statusVariant = status.isRunning 
    ? 'default' 
    : status.isInstalled 
      ? 'secondary' 
      : 'outline';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Local Server Agent</CardTitle>
              <CardDescription>Monitor this server machine</CardDescription>
            </div>
          </div>
          
          <Badge variant={statusVariant}>
            {status.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Actions */}
        <div className="flex gap-2">
          {!status.isInstalled && (
            <ConfirmationModal
              title="Install Local Agent"
              message="This will install the ManLab agent on this server machine, allowing you to monitor the server itself. The agent will run as a scheduled task."
              confirmText="Install"
              onConfirm={() => installMutation.mutate(false)}
              trigger={
                <Button
                  className="flex-1"
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
                    variant="secondary"
                    className="flex-1"
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
                    variant="destructive"
                    className="flex-1"
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
          <div className="space-x-2 text-sm">
            <span className="text-muted-foreground">Linked node:</span>
            <a
              href={`/nodes/${status.linkedNodeId}`}
              className="font-mono underline underline-offset-4"
            >
              {status.linkedNodeId.substring(0, 8)}...
            </a>
          </div>
        )}

        {/* Logs Toggle */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowLogs(!showLogs)}
          className="w-fit"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${showLogs ? 'rotate-90' : ''}`} />
          {showLogs ? 'Hide' : 'Show'} installation logs ({logs.length})
        </Button>

        {/* Logs */}
        {showLogs && logs.length > 0 && (
          <Card>
            <CardContent className="max-h-48 overflow-y-auto py-3 font-mono text-xs">
              {logs.map((log, i) => (
                <div key={i} className={log.message.includes('ERROR') ? 'text-destructive' : 'text-muted-foreground'}>
                  <span className="text-muted-foreground/70">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  {' '}
                  {log.message}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Error Display */}
        {(installMutation.error || uninstallMutation.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {installMutation.error?.message || uninstallMutation.error?.message}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
