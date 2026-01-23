/**
 * NetworkToolHistoryPanel Component
 * Displays network tool execution history with filtering and details.
 */

import { useState } from "react";
import {
  History,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Radio,
  Route,
  Scan,
  Network,
  Search,
  Wifi,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNetworkToolHistory } from "@/hooks/useNetworkToolHistory";
import type { NetworkToolType, ParsedHistoryEntry } from "@/contexts/network-tool-history-types";

/**
 * Get icon for tool type.
 */
function getToolIcon(toolType: NetworkToolType) {
  switch (toolType) {
    case "ping":
      return <Radio className="h-4 w-4" />;
    case "traceroute":
      return <Route className="h-4 w-4" />;
    case "port-scan":
      return <Scan className="h-4 w-4" />;
    case "subnet-scan":
      return <Network className="h-4 w-4" />;
    case "discovery":
      return <Search className="h-4 w-4" />;
    case "wifi-scan":
      return <Wifi className="h-4 w-4" />;
    default:
      return <History className="h-4 w-4" />;
  }
}

/**
 * Get human-readable label for tool type.
 */
function getToolLabel(toolType: NetworkToolType): string {
  switch (toolType) {
    case "ping":
      return "Ping";
    case "traceroute":
      return "Traceroute";
    case "port-scan":
      return "Port Scan";
    case "subnet-scan":
      return "Subnet Scan";
    case "discovery":
      return "Device Discovery";
    case "wifi-scan":
      return "WiFi Scan";
    default:
      return toolType;
  }
}

/**
 * Format timestamp for display.
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format duration for display.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

interface HistoryRowProps {
  entry: ParsedHistoryEntry;
  onDelete: (id: string) => void;
}

function HistoryRow({ entry, onDelete }: HistoryRowProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <TableRow className="group">
        <TableCell>
          <div className="flex items-center gap-2">
            {getToolIcon(entry.toolType)}
            <span className="font-medium">{getToolLabel(entry.toolType)}</span>
          </div>
        </TableCell>
        <TableCell className="font-mono text-sm">
          {entry.target || "—"}
        </TableCell>
        <TableCell>
          {entry.success ? (
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Success
            </Badge>
          ) : (
            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-900/20">
              <XCircle className="h-3 w-3 mr-1" />
              Failed
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(entry.durationMs)}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatTimestamp(entry.timestamp)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <CollapsibleTrigger>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
      </TableRow>
      <CollapsibleContent>
        <TableRow className="bg-muted/30">
          <TableCell colSpan={6} className="p-4">
            <div className="grid gap-4 md:grid-cols-2">
              {entry.input && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Input Parameters</h4>
                  <ScrollArea className="h-32 rounded border bg-muted/50 p-2">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(entry.input, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              )}
              {entry.result && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Result</h4>
                  <ScrollArea className="h-32 rounded border bg-muted/50 p-2">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              )}
              {entry.error && (
                <div className="md:col-span-2">
                  <h4 className="text-sm font-medium mb-2 text-destructive">Error</h4>
                  <p className="text-sm text-destructive">{entry.error}</p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NetworkToolHistoryPanel() {
  const {
    history,
    isLoading,
    error,
    refresh,
    deleteEntry,
    activeFilter,
    setFilter,
  } = useNetworkToolHistory();

  const toolTypes: NetworkToolType[] = [
    "ping",
    "traceroute",
    "port-scan",
    "subnet-scan",
    "discovery",
    "wifi-scan",
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Tool History
              </CardTitle>
              <CardDescription>
                Recent network tool executions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={activeFilter ?? "all"}
                onValueChange={(value) =>
                  setFilter(value === "all" ? null : (value as NetworkToolType))
                }
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter by tool" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tools</SelectItem>
                  {toolTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        {getToolIcon(type)}
                        {getToolLabel(type)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={refresh}
                    disabled={isLoading}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="flex items-center gap-2 p-4 mb-4 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isLoading && history.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No history yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Network tool executions will appear here after you run scans.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Tool</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[100px]">Duration</TableHead>
                    <TableHead className="w-[120px]">Time</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onDelete={deleteEntry}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {isLoading && history.length > 0 && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
