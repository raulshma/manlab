/**
 * NetworkToolHistoryPanel Component
 * Advanced network tool execution history UI.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History,
  RefreshCw,
  Trash2,
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
  Globe,
  LocateFixed,
  BookText,
  Power,
  ShieldCheck,
  Fingerprint,
  Gauge,
  Filter,
  Download,
  Save,
  SlidersHorizontal,
  Tag,
  FileText,
  ChevronRight,
  ChevronLeft,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useNetworkToolHistory } from "@/hooks/useNetworkToolHistory";
import { exportNetworkToolHistory } from "@/api/networkApi";
import { cn } from "@/lib/utils";
import type {
  HistorySortBy,
  HistorySortDir,
  HistoryStatusFilter,
  NetworkToolHistoryQueryState,
  NetworkToolType,
  ParsedHistoryEntry,
} from "@/contexts/network-tool-history-types";

const TOOL_TYPES: NetworkToolType[] = [
  "ping",
  "traceroute",
  "port-scan",
  "subnet-scan",
  "topology",
  "discovery",
  "wifi-scan",
  "dns-lookup",
  "whois",
  "public-ip",
  "wol",
  "ssl-inspect",
  "mac-vendor",
  "speedtest",
  "arp-table",
];

const SAVED_VIEWS_KEY = "manlab:network:history:saved-views";

interface SavedView {
  id: string;
  name: string;
  query: NetworkToolHistoryQueryState;
  createdAt: string;
}

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
    case "topology":
      return <Network className="h-4 w-4" />;
    case "discovery":
      return <Search className="h-4 w-4" />;
    case "wifi-scan":
      return <Wifi className="h-4 w-4" />;
    case "dns-lookup":
      return <Globe className="h-4 w-4" />;
    case "whois":
      return <BookText className="h-4 w-4" />;
    case "public-ip":
      return <LocateFixed className="h-4 w-4" />;
    case "wol":
      return <Power className="h-4 w-4" />;
    case "ssl-inspect":
      return <ShieldCheck className="h-4 w-4" />;
    case "mac-vendor":
      return <Fingerprint className="h-4 w-4" />;
    case "speedtest":
      return <Gauge className="h-4 w-4" />;
    case "arp-table":
      return <Network className="h-4 w-4" />;
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
    case "topology":
      return "Topology Map";
    case "discovery":
      return "Device Discovery";
    case "wifi-scan":
      return "WiFi Scan";
    case "dns-lookup":
      return "DNS Lookup";
    case "whois":
      return "WHOIS";
    case "public-ip":
      return "Public IP";
    case "wol":
      return "Wake-on-LAN";
    case "ssl-inspect":
      return "SSL Inspect";
    case "mac-vendor":
      return "MAC Vendor";
    case "speedtest":
      return "Speed Test";
    case "arp-table":
      return "ARP Table";
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

function formatTimestampLong(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getStatusBadge(success: boolean) {
  return success ? (
    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Success
    </Badge>
  ) : (
    <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-900/20">
      <XCircle className="h-3 w-3 mr-1" />
      Failed
    </Badge>
  );
}

interface HistoryRowProps {
  entry: ParsedHistoryEntry;
  onDelete: (id: string) => void;
  onView: (entry: ParsedHistoryEntry) => void;
}

function HistoryRow({ entry, onDelete, onView }: HistoryRowProps) {
  return (
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
      <TableCell>{getStatusBadge(entry.success)}</TableCell>
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
        <div className="flex flex-wrap items-center gap-1">
          {entry.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {entry.tags.length > 2 && (
            <Badge variant="outline" className="text-xs">+{entry.tags.length - 2}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onView(entry)}
            aria-label="View history entry"
          >
            View
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => onDelete(entry.id)}
                aria-label="Delete history entry"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface HistoryDetailsContentProps {
  entry: ParsedHistoryEntry;
  onUpdateMetadata: (id: string, tags: string[], notes: string) => Promise<void>;
}

function HistoryDetailsContent({ entry, onUpdateMetadata }: HistoryDetailsContentProps) {
  const [tags, setTags] = useState<string[]>(() => entry.tags ?? []);
  const [notes, setNotes] = useState<string>(() => entry.notes ?? "");
  const [tagInput, setTagInput] = useState("");

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    setTags((prev) => {
      if (prev.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = async () => {
    await onUpdateMetadata(entry.id, tags, notes);
  };

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 overflow-y-auto">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Target</div>
            <div className="text-sm font-mono break-all">{entry.target || "—"}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="mt-2">{getStatusBadge(entry.success)}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="text-lg font-semibold">{formatDuration(entry.durationMs)}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Executed</div>
            <div className="text-sm">{formatTimestampLong(entry.timestamp)}</div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Tag className="h-4 w-4" />
          Tags
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-2">
              {tag}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleRemoveTag(tag)}
              >
                ×
              </button>
            </Badge>
          ))}
          {tags.length === 0 && (
            <span className="text-xs text-muted-foreground">No tags yet</span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            placeholder="Add a tag and press Enter"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                handleAddTag();
              }
            }}
          />
          <Button variant="outline" onClick={handleAddTag}>Add</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          Notes
        </div>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add annotations or operator notes"
          rows={4}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4" />
          Request & response payloads
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {entry.input && (
            <div>
              <h4 className="text-xs font-medium mb-2 text-muted-foreground">Input</h4>
              <ScrollArea className="h-40 rounded border bg-muted/40 p-2">
                <pre className="text-xs font-mono">
                  {JSON.stringify(entry.input, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
          {entry.result && (
            <div>
              <h4 className="text-xs font-medium mb-2 text-muted-foreground">Result</h4>
              <ScrollArea className="h-40 rounded border bg-muted/40 p-2">
                <pre className="text-xs font-mono">
                  {JSON.stringify(entry.result, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
        {entry.error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {entry.error}
          </div>
        )}
      </div>

      <Button onClick={handleSave} className="self-start">
        Save metadata
      </Button>
    </div>
  );
}

export function NetworkToolHistoryPanel() {
  const {
    history,
    totalCount,
    isLoading,
    error,
    refresh,
    deleteEntry,
    updateMetadata,
    query,
    setQuery,
  } = useNetworkToolHistory();

  const [selectedEntry, setSelectedEntry] = useState<ParsedHistoryEntry | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(query.search);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
      return raw ? (JSON.parse(raw) as SavedView[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    if (query.search !== searchInput) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchInput(query.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery({ search: searchInput });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, setQuery]);

  const stats = useMemo(() => {
    const total = history.length;
    const successCount = history.filter((entry) => entry.success).length;
    const failureCount = total - successCount;
    const avgDuration = total
      ? Math.round(history.reduce((acc, entry) => acc + entry.durationMs, 0) / total)
      : 0;
    const successRate = total ? Math.round((successCount / total) * 100) : 0;
    const lastRun = history[0] ? formatTimestamp(history[0].timestamp) : "—";

    return {
      total,
      successCount,
      failureCount,
      avgDuration,
      successRate,
      lastRun,
    };
  }, [history]);

  const totalPages = useMemo(() => {
    if (!query.pageSize) return 1;
    return Math.max(1, Math.ceil(totalCount / query.pageSize));
  }, [query.pageSize, totalCount]);

  const handleView = useCallback((entry: ParsedHistoryEntry) => {
    setSelectedEntry(entry);
    setDetailsOpen(true);
  }, []);

  const handleApplySavedView = useCallback((view: SavedView) => {
    setQuery({ ...view.query, page: 1 });
  }, [setQuery]);

  const handleDeleteSavedView = useCallback((id: string) => {
    setSavedViews((prev) => prev.filter((view) => view.id !== id));
  }, []);

  const handleSaveView = useCallback(() => {
    const name = saveViewName.trim();
    if (!name) return;

    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;

    setSavedViews((prev) => [
      {
        id,
        name,
        query,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setSaveViewName("");
    setSaveDialogOpen(false);
  }, [query, saveViewName]);

  const handleExport = useCallback(async (format: "csv" | "json") => {
    const blob = await exportNetworkToolHistory({
      toolTypes: query.toolTypes,
      status: query.status,
      search: query.search,
      fromUtc: query.fromUtc,
      toUtc: query.toUtc,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    }, format);

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `network-tool-history.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, [query]);



  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Tool History
              </CardTitle>
              <CardDescription>
                Advanced history for network tools, with filters, saved views, and exports.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={isLoading}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                Refresh
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("json")}>Export JSON</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Save className="h-4 w-4 mr-2" />
                    Save View
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save current view</DialogTitle>
                    <DialogDescription>
                      Store this filter set as a reusable view.
                    </DialogDescription>
                  </DialogHeader>
                  <Input
                    placeholder="View name"
                    value={saveViewName}
                    onChange={(event) => setSaveViewName(event.target.value)}
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveView} disabled={!saveViewName.trim()}>
                      Save view
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">This view</div>
                <div className="text-2xl font-semibold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Entries on this page</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-4 space-y-2">
                <div className="text-xs text-muted-foreground">Success rate</div>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-semibold">{stats.successRate}%</span>
                  <span className="text-xs text-muted-foreground">{stats.successCount} ok</span>
                </div>
                <Progress value={stats.successRate} className="h-2" />
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Avg duration</div>
                <div className="text-2xl font-semibold">{formatDuration(stats.avgDuration)}</div>
                <div className="text-xs text-muted-foreground">Failures: {stats.failureCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Latest execution</div>
                <div className="text-lg font-semibold">{stats.lastRun}</div>
                <div className="text-xs text-muted-foreground">Total matching: {totalCount}</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 lg:flex-row">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Search</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search targets, errors, or tool types"
                    className="pl-9"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <Select
                  value={query.status}
                  onValueChange={(value) => setQuery({ status: value as HistoryStatusFilter })}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Tools</div>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="outline" className="justify-between w-44">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        {query.toolTypes.length ? `${query.toolTypes.length} selected` : "All tools"}
                      </div>
                      <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Filter tools</DropdownMenuLabel>
                      {TOOL_TYPES.map((type) => (
                        <DropdownMenuCheckboxItem
                          key={type}
                          checked={query.toolTypes.includes(type)}
                          onCheckedChange={(checked) => {
                            setQuery({
                              toolTypes: checked
                                ? [...query.toolTypes, type]
                                : query.toolTypes.filter((item) => item !== type),
                            });
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {getToolIcon(type)}
                            {getToolLabel(type)}
                          </div>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setQuery({ toolTypes: [] })}>Clear filters</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <div className="text-xs text-muted-foreground mb-1">From</div>
                <Input
                  type="date"
                  value={toDateInputValue(query.fromUtc)}
                  onChange={(event) => setQuery({ fromUtc: dateInputToIso(event.target.value) })}
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">To</div>
                <Input
                  type="date"
                  value={toDateInputValue(query.toUtc)}
                  onChange={(event) => setQuery({ toUtc: dateInputToIso(event.target.value) })}
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Sort by</div>
                <Select
                  value={query.sortBy}
                  onValueChange={(value) => setQuery({ sortBy: value as HistorySortBy })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="timestamp">Time</SelectItem>
                    <SelectItem value="duration">Duration</SelectItem>
                    <SelectItem value="tool">Tool</SelectItem>
                    <SelectItem value="target">Target</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Order</div>
                <Select
                  value={query.sortDir}
                  onValueChange={(value) => setQuery({ sortDir: value as HistorySortDir })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Desc</SelectItem>
                    <SelectItem value="asc">Asc</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {savedViews.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">Saved views</Badge>
              {savedViews.slice(0, 4).map((view) => (
                <Button
                  key={view.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => handleApplySavedView(view)}
                  className="gap-2"
                >
                  {view.name}
                </Button>
              ))}
              {savedViews.length > 4 && (
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="outline" size="sm">More</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {savedViews.map((view) => (
                      <DropdownMenuItem
                        key={view.id}
                        onClick={() => handleApplySavedView(view)}
                        className="flex items-center justify-between"
                      >
                        <span>{view.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteSavedView(view.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Tool</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-28">Duration</TableHead>
                    <TableHead className="w-32">Time</TableHead>
                    <TableHead className="w-32">Tags</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody className="[content-visibility:auto]">
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onDelete={deleteEntry}
                      onView={handleView}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Showing {history.length} of {totalCount} entries
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuery({ page: Math.max(1, query.page - 1) })}
                disabled={query.page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {query.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuery({ page: Math.min(totalPages, query.page + 1) })}
                disabled={query.page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Select
                value={String(query.pageSize)}
                onValueChange={(value) => setQuery({ pageSize: Number(value) })}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="25">25 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading && history.length > 0 && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Execution details</SheetTitle>
            <SheetDescription>
              {selectedEntry ? `${getToolLabel(selectedEntry.toolType)} • ${formatTimestampLong(selectedEntry.timestamp)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {selectedEntry && (
            <HistoryDetailsContent
              key={selectedEntry.id}
              entry={selectedEntry}
              onUpdateMetadata={updateMetadata}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
