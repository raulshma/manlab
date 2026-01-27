import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Node } from '../types';
import { Globe, Monitor, Tag, AlertTriangle, ArrowUpCircle, CheckCircle2 } from 'lucide-react';
import { useAgentUpdateCheck } from '@/hooks/useAgentUpdateCheck';

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
 * Returns badge variant based on node status.
 */
function getStatusVariant(status: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (status) {
    case 'Online':
      return 'default';
    case 'Offline':
      return 'destructive';
    case 'Error':
      return 'destructive';
    case 'Maintenance':
      return 'secondary';
    default:
      return 'outline';
  }
}

/**
 * NodeCard component displaying node information with status indicators.
 */
export function NodeCard({ node, onClick }: NodeCardProps) {
  const statusVariant = getStatusVariant(node.status);
  const isError = node.status === 'Error';

  // Check for agent updates
  const { hasUpdate, latestVersion, loading: updateCheckLoading } = useAgentUpdateCheck(
    node.id,
    node.agentVersion
  );

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`cursor-pointer ${isError ? 'border-destructive' : ''}`}
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          {/* Node Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              {/* Error indicator */}
              {isError && (
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              )}
              {/* Hostname */}
              <h3 className="text-base font-semibold text-foreground truncate">
                {node.hostname}
              </h3>
              
              {/* Update indicator */}
              {!updateCheckLoading && hasUpdate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ArrowUpCircle className="h-5 w-5 text-blue-500 shrink-0 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="font-semibold">Agent update available</p>
                    <p className="text-sm text-muted-foreground">
                      Upgrade from v{node.agentVersion} to v{latestVersion}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              
              {/* Latest version indicator (when no update available) */}
              {!updateCheckLoading && !hasUpdate && node.agentVersion && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-sm">Running latest agent version</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Details */}
            <div className="space-y-1.5 text-sm">
              {node.ipAddress && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="h-4 w-4" />
                  <span className="font-mono">{node.ipAddress}</span>
                </div>
              )}
              
              {node.os && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Monitor className="h-4 w-4" />
                  <span className="truncate">{node.os}</span>
                </div>
              )}

              {node.agentVersion && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Tag className="h-4 w-4" />
                  <span>v{node.agentVersion}</span>
                </div>
              )}

              {/* Error message */}
              {isError && node.errorMessage && (
                <div className="flex items-center gap-2 text-destructive">
                  <span className="text-xs truncate">
                    Error {node.errorCode}: {node.errorMessage}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Status Badge & Last Seen */}
          <div className="flex flex-col items-end gap-2">
            {isError && node.errorMessage ? (
              <Tooltip>
                <TooltipTrigger className="cursor-help">
                  <Badge variant={statusVariant}>
                    {node.status}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  <p className="font-semibold">Error {node.errorCode}</p>
                  <p className="text-sm">{node.errorMessage}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge variant={statusVariant}>
                {node.status}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(node.lastSeen)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

