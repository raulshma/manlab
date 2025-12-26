/**
 * ContainerList component for displaying Docker containers.
 * Shows container status with restart action buttons.
 */

import { Button } from '@/components/ui/button';
import type { Container } from '../types';
import { ConfirmationModal } from './ConfirmationModal';

interface ContainerListProps {
  containers: Container[];
  isLoading?: boolean;
  onRestart: (containerId: string) => Promise<void>;
}

/**
 * Returns status indicator styles based on container state.
 */
function getContainerStateStyles(state: string): {
  dotClass: string;
  badgeClass: string;
  label: string;
} {
  switch (state.toLowerCase()) {
    case 'running':
      return {
        dotClass: 'bg-emerald-500 animate-pulse',
        badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        label: 'Running',
      };
    case 'exited':
      return {
        dotClass: 'bg-slate-500',
        badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        label: 'Exited',
      };
    case 'paused':
      return {
        dotClass: 'bg-amber-500',
        badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        label: 'Paused',
      };
    case 'restarting':
      return {
        dotClass: 'bg-blue-500 animate-pulse',
        badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        label: 'Restarting',
      };
    case 'dead':
      return {
        dotClass: 'bg-red-500',
        badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
        label: 'Dead',
      };
    default:
      return {
        dotClass: 'bg-slate-500',
        badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        label: state,
      };
  }
}

/**
 * Gets the primary container name (removes leading slash).
 */
function getPrimaryName(names: string[]): string {
  if (names.length === 0) return 'Unknown';
  // Container names typically start with '/'
  return names[0].replace(/^\//, '');
}

/**
 * ContainerList displays a list of Docker containers with actions.
 */
export function ContainerList({ containers, isLoading, onRestart }: ContainerListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 animate-pulse"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                <div className="h-4 w-32 bg-slate-600 rounded" />
              </div>
              <div className="h-6 w-16 bg-slate-600 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (containers.length === 0) {
    return (
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-8 text-center">
        <svg
          className="w-12 h-12 mx-auto mb-4 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
          />
        </svg>
        <p className="text-slate-400 text-sm">No containers found</p>
        <p className="text-slate-500 text-xs mt-1">
          Docker containers will appear here when available
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {containers.map((container) => {
        const stateStyles = getContainerStateStyles(container.state);
        const name = getPrimaryName(container.names);

        return (
          <div
            key={container.id}
            className="bg-slate-800/50 border border-slate-700 rounded-lg p-4
                       hover:bg-slate-800 hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <div className={`w-2.5 h-2.5 rounded-full ${stateStyles.dotClass}`} />
                  <h4 className="text-sm font-medium text-white truncate">
                    {name}
                  </h4>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full border ${stateStyles.badgeClass}`}
                  >
                    {stateStyles.label}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400 ml-5">
                  <span className="truncate" title={container.image}>
                    {container.image}
                  </span>
                  <span className="text-slate-500">
                    {container.status}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <ConfirmationModal
                  trigger={
                    <Button
                      className="px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10
                               hover:bg-blue-500/20 border border-blue-500/30 rounded-lg
                               transition-colors cursor-pointer focus:outline-none focus:ring-2
                               focus:ring-blue-500"
                    >
                      Restart
                    </Button>
                  }
                  title="Restart Container"
                  message={`Are you sure you want to restart the container "${name}"? This may cause temporary service interruption.`}
                  confirmText="Restart"
                  onConfirm={() => onRestart(container.id)}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
