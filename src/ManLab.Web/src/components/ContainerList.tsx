/**
 * ContainerList component for displaying Docker containers.
 * Shows container status with restart action buttons.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Box } from 'lucide-react';
import type { Container } from '../types';
import { ConfirmationModal } from './ConfirmationModal';

interface ContainerListProps {
  containers: Container[];
  isLoading?: boolean;
  onRestart: (containerId: string) => Promise<void>;
}

/**
 * Returns badge variant based on container state.
 */
function getContainerStateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state.toLowerCase()) {
    case 'running':
      return 'default';
    case 'exited':
      return 'outline';
    case 'paused':
      return 'secondary';
    case 'restarting':
      return 'secondary';
    case 'dead':
      return 'destructive';
    default:
      return 'outline';
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
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-2.5 h-2.5 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (containers.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Box className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-sm">No containers found</p>
          <p className="text-muted-foreground/70 text-xs mt-1">
            Docker containers will appear here when available
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {containers.map((container) => {
        const stateVariant = getContainerStateVariant(container.state);
        const name = getPrimaryName(container.names);

        return (
          <Card key={container.id} className="hover:ring-1 hover:ring-ring transition-all">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      container.state.toLowerCase() === 'running' ? 'bg-primary animate-pulse' :
                      container.state.toLowerCase() === 'dead' ? 'bg-destructive' : 'bg-muted'
                    }`} />
                    <h4 className="text-sm font-medium text-foreground truncate">
                      {name}
                    </h4>
                    <Badge variant={stateVariant}>
                      {container.state}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground ml-5">
                    <span className="truncate" title={container.image}>
                      {container.image}
                    </span>
                    <span className="text-muted-foreground/70">
                      {container.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <ConfirmationModal
                    trigger={
                      <Button variant="outline" size="sm">
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
