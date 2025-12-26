import type { Node } from '../types';

interface NodeCardProps {
  node: Node;
  onClick?: () => void;
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
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
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
 * NodeCard component displaying node information with status indicators.
 */
export function NodeCard({ node, onClick }: NodeCardProps) {
  const statusStyles = getStatusStyles(node.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 cursor-pointer
                 hover:bg-slate-800 hover:border-slate-600 hover:shadow-lg hover:shadow-slate-900/50
                 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500
                 focus:ring-offset-2 focus:ring-offset-slate-900"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Node Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            {/* Status Dot */}
            <div className={`w-2.5 h-2.5 rounded-full ${statusStyles.dotClass}`} />
            
            {/* Hostname */}
            <h3 className="text-base font-semibold text-white truncate">
              {node.hostname}
            </h3>
          </div>

          {/* Details */}
          <div className="space-y-1.5 text-sm">
            {node.ipAddress && (
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="font-mono">{node.ipAddress}</span>
              </div>
            )}
            
            {node.os && (
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{node.os}</span>
              </div>
            )}

            {node.agentVersion && (
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span>v{node.agentVersion}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status Badge & Last Seen */}
        <div className="flex flex-col items-end gap-2">
          <span
            className={`px-2.5 py-1 text-xs font-medium rounded-full border ${statusStyles.badgeClass}`}
          >
            {statusStyles.label}
          </span>
          <span className="text-xs text-slate-500">
            {formatRelativeTime(node.lastSeen)}
          </span>
        </div>
      </div>
    </div>
  );
}
