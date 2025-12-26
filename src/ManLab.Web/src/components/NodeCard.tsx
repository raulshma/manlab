import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Node } from '../types';
import { Globe, Monitor, Tag } from 'lucide-react';

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
      className="cursor-pointer"
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          {/* Node Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              {/* Hostname */}
              <h3 className="text-base font-semibold text-foreground truncate">
                {node.hostname}
              </h3>
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
            </div>
          </div>

          {/* Status Badge & Last Seen */}
          <div className="flex flex-col items-end gap-2">
            <Badge variant={statusVariant}>
              {node.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(node.lastSeen)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
