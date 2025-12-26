import { useQuery } from '@tanstack/react-query';
import { fetchNodes } from '../api';
import { NodeCard } from './NodeCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Server } from 'lucide-react';

interface NodeGridProps {
  onSelectNode?: (nodeId: string) => void;
}

/**
 * NodeGrid component that fetches and displays all nodes.
 */
export function NodeGrid({ onSelectNode }: NodeGridProps) {
  const {
    data: nodes,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['nodes'],
    queryFn: fetchNodes,
    refetchInterval: 30000, // Refetch every 30 seconds as backup
    staleTime: 10000, // Consider data stale after 10 seconds
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-4">
                <Skeleton className="w-2.5 h-2.5 rounded-full" />
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-36" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load nodes</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : 'Unknown error occurred'}
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (!nodes || nodes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Server className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-foreground font-medium mb-1">No nodes connected</h3>
          <p className="text-muted-foreground text-sm">
            Add your first node to start monitoring
          </p>
        </CardContent>
      </Card>
    );
  }

  // Nodes grid
  return (
    <div
      role="list"
      aria-label="Device nodes"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {nodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          onClick={() => onSelectNode?.(node.id)}
        />
      ))}
    </div>
  );
}
