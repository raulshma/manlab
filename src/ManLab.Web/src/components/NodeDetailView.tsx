/**
 * NodeDetailView component for detailed node information.
 * Shows telemetry charts, Docker containers, and system actions.
 */

import { Button } from '@/components/ui/button';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Container } from '../types';
import { fetchNode, fetchNodeTelemetry, restartContainer, triggerSystemUpdate } from '../api';
import { TelemetryChart } from './TelemetryChart';
import { ContainerList } from './ContainerList';
import { ConfirmationModal } from './ConfirmationModal';

interface NodeDetailViewProps {
  nodeId: string;
  onBack: () => void;
}

/**
 * Returns status indicator styles based on node status.
 */
function getStatusStyles(status: string): {
  dotClass: string;
  badgeClass: string;
  label: string;
} {
  switch (status) {
    case 'Online':
      return {
        dotClass: 'bg-emerald-500 animate-pulse',
        badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        label: 'Online',
      };
    case 'Offline':
      return {
        dotClass: 'bg-red-500',
        badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
        label: 'Offline',
      };
    case 'Maintenance':
      return {
        dotClass: 'bg-amber-500 animate-pulse',
        badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        label: 'Maintenance',
      };
    default:
      return {
        dotClass: 'bg-slate-500',
        badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        label: 'Unknown',
      };
  }
}

/**
 * Formats a date string to a relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
}

/**
 * NodeDetailView displays detailed information about a specific node.
 */
export function NodeDetailView({ nodeId, onBack }: NodeDetailViewProps) {
  // Fetch node details
  const { data: node, isLoading: nodeLoading, error: nodeError } = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => fetchNode(nodeId),
  });

  // Fetch telemetry history
  const { data: telemetry } = useQuery({
    queryKey: ['telemetry', nodeId],
    queryFn: () => fetchNodeTelemetry(nodeId, 30),
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // For now, we'll use mock containers - in a real app, this would come from the server
  // via a SignalR command to query the agent
  const mockContainers: Container[] = [];

  // Restart container mutation
  const restartMutation = useMutation({
    mutationFn: (containerId: string) => restartContainer(nodeId, containerId),
    onSuccess: () => {
      // Could invalidate/refetch containers query when implemented
    },
  });

  // System update mutation
  const updateMutation = useMutation({
    mutationFn: () => triggerSystemUpdate(nodeId),
    onSuccess: () => {
      // Could show success notification
    },
  });

  if (nodeLoading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-slate-300">Loading node details...</span>
        </div>
      </div>
    );
  }

  if (nodeError || !node) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-white mb-2">Node Not Found</h2>
          <p className="text-slate-400 mb-4">The requested node could not be found.</p>
          <Button
            onClick={onBack}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                     rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2
                     focus:ring-blue-500"
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const statusStyles = getStatusStyles(node.status);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/50 border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button
              onClick={onBack}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg
                       transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${statusStyles.dotClass}`} />
                <h1 className="text-xl font-semibold">{node.hostname}</h1>
                <span
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border ${statusStyles.badgeClass}`}
                >
                  {statusStyles.label}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Last seen: {formatRelativeTime(node.lastSeen)}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Node Info Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <dt className="text-xs text-slate-400 uppercase tracking-wider">IP Address</dt>
            <dd className="text-sm font-mono text-white mt-1">{node.ipAddress || 'N/A'}</dd>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Operating System</dt>
            <dd className="text-sm text-white mt-1 truncate">{node.os || 'N/A'}</dd>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Agent Version</dt>
            <dd className="text-sm text-white mt-1">{node.agentVersion ? `v${node.agentVersion}` : 'N/A'}</dd>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <dt className="text-xs text-slate-400 uppercase tracking-wider">Registered</dt>
            <dd className="text-sm text-white mt-1">{new Date(node.createdAt).toLocaleDateString()}</dd>
          </div>
        </div>

        {/* Telemetry Charts */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">System Telemetry</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TelemetryChart
              data={telemetry || []}
              metric="cpuUsage"
              label="CPU Usage"
              color="#3b82f6"
            />
            <TelemetryChart
              data={telemetry || []}
              metric="ramUsage"
              label="RAM Usage"
              color="#10b981"
            />
            <TelemetryChart
              data={telemetry || []}
              metric="diskUsage"
              label="Disk Usage"
              color="#f59e0b"
            />
          </div>
        </section>

        {/* Docker Containers */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Docker Containers</h2>
          </div>
          <ContainerList
            containers={mockContainers}
            onRestart={async (containerId) => { await restartMutation.mutateAsync(containerId); }}
          />
        </section>

        {/* System Actions */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">System Actions</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-white">System Update</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Run system package updates on this node. This will update all installed packages.
                </p>
              </div>
              <ConfirmationModal
                trigger={
                  <Button
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                             rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2
                             focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-800
                             disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={node.status !== 'Online'}
                  >
                    Update System
                  </Button>
                }
                title="Confirm System Update"
                message={`Are you sure you want to run a system update on "${node.hostname}"? This may require a reboot and could cause temporary service interruption.`}
                confirmText="Run Update"
                isDestructive
                isLoading={updateMutation.isPending}
                onConfirm={async () => { await updateMutation.mutateAsync(); }}
              />
            </div>
            {node.status !== 'Online' && (
              <p className="text-xs text-amber-400 mt-3">
                ⚠️ System actions are only available when the node is online.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
