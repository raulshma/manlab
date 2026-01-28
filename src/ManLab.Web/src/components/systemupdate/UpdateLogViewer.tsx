import { useState, useMemo } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { XCircle, Search, Download, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { getSystemUpdateLogs } from "@/api";
import type { SystemUpdateLog } from "@/types";

interface UpdateLogViewerProps {
  updateId: string;
  onClose?: () => void;
}

export function UpdateLogViewer({ updateId, onClose }: UpdateLogViewerProps) {
  const { data: logs, isLoading, error } = useSWR(
    ["systemUpdateLogs", updateId],
    () => getSystemUpdateLogs(updateId),
    { refreshInterval: 5000 }
  );

  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLogs = useMemo(() => {
    if (!logs) return [];

    return logs.filter((log) => {
      const matchesLevel = filterLevel === "all" || log.level === filterLevel;
      const matchesSearch =
        !searchQuery ||
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.details?.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesLevel && matchesSearch;
    });
  }, [logs, filterLevel, searchQuery]);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "Error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "Warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "Info":
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLevelBadge = (level: string) => {
    const variants: Record<string, string> = {
      Error: "destructive",
      Warning: "secondary",
      Info: "outline",
      Debug: "outline",
    };

    return <Badge variant={(variants[level] as "default" | "secondary" | "destructive" | "outline") || "outline"} className="text-xs">{level}</Badge>;
  };

  const handleDownload = () => {
    if (!logs) return;

    const content = logs
      .map((log) => `[${log.timestampUtc}] [${log.level}] ${log.message}${log.details ? "\n" + log.details : ""}`)
      .join("\n\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-update-${updateId}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading logs...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">Failed to load logs</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">No logs available for this update</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Update Logs</CardTitle>
          <div className="flex items-center gap-2">
            <Button onClick={handleDownload} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            {onClose && (
              <Button onClick={onClose} variant="ghost" size="sm">
                <XCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="search" className="text-xs">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div className="w-full sm:w-40">
            <Label htmlFor="level" className="text-xs">
              Level
            </Label>
            <Select value={filterLevel} onValueChange={(v) => setFilterLevel(v ?? "all")}>
              <SelectTrigger id="level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="Error">Error</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="Info">Info</SelectItem>
                <SelectItem value="Debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results Count */}
        <div className="text-xs text-muted-foreground">
          Showing {filteredLogs.length} of {logs.length} log entries
        </div>

        {/* Logs */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredLogs.map((log) => (
            <LogEntry key={log.id} log={log} getLevelIcon={getLevelIcon} getLevelBadge={getLevelBadge} />
          ))}
        </div>

        {filteredLogs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No logs match the current filters
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LogEntryProps {
  log: SystemUpdateLog;
  getLevelIcon: (level: string) => React.ReactNode;
  getLevelBadge: (level: string) => React.ReactNode;
}

function LogEntry({ log, getLevelIcon, getLevelBadge }: LogEntryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 bg-muted/30 rounded hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getLevelIcon(log.level)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {getLevelBadge(log.level)}
            <span className="text-sm font-medium truncate">{log.message}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {new Date(log.timestampUtc).toLocaleString()}
          </div>
          {log.details && (
            <CollapsibleSection details={log.details} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
          )}
        </div>
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  details: string;
  expanded: boolean;
  onToggle: () => void;
}

function CollapsibleSection({ details, expanded, onToggle }: CollapsibleSectionProps) {
  const shouldTruncate = details.length > 200;

  if (!shouldTruncate && !expanded) {
    return (
      <pre className="text-xs bg-background p-2 rounded mt-2 overflow-x-auto">
        {details}
      </pre>
    );
  }

  return (
    <div className="mt-2">
      <Collapsible open={expanded} onOpenChange={onToggle}>
        <CollapsibleTrigger className="px-2 py-1 h-6 text-xs bg-transparent hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
          {expanded ? "Hide" : "Show"} Details
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-xs bg-background p-2 rounded mt-2 overflow-x-auto max-h-64 overflow-y-auto">
            {details}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
