/**
 * NodeGrid component for displaying all nodes in a grid layout.
 * Uses React Aria GridList for accessibility and keyboard navigation.
 */

import { GridList, type Selection } from 'react-aria-components';
import { useQuery } from '@tanstack/react-query';
import { fetchNodes } from '../api';
import { NodeCard } from './NodeCard';

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

  const handleSelectionChange = (selection: Selection) => {
    if (selection === 'all') return;
    const selectedId = [...selection][0];
    if (selectedId && onSelectNode) {
      onSelectNode(String(selectedId));
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 animate-pulse"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              <div className="h-5 w-32 bg-slate-700 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-24 bg-slate-700/50 rounded" />
              <div className="h-4 w-36 bg-slate-700/50 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <svg
          className="w-12 h-12 text-red-400 mx-auto mb-3"
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
        <h3 className="text-red-400 font-medium mb-1">Failed to load nodes</h3>
        <p className="text-red-400/70 text-sm">
          {error instanceof Error ? error.message : 'Unknown error occurred'}
        </p>
      </div>
    );
  }

  // Empty state
  if (!nodes || nodes.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
        </div>
        <h3 className="text-slate-300 font-medium mb-1">No nodes connected</h3>
        <p className="text-slate-500 text-sm">
          Add your first node to start monitoring
        </p>
      </div>
    );
  }

  // Nodes grid
  return (
    <GridList
      aria-label="Device nodes"
      selectionMode="single"
      onSelectionChange={handleSelectionChange}
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {nodes.map((node) => (
        <NodeCard key={node.id} node={node} />
      ))}
    </GridList>
  );
}

