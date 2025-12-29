import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchAuditEvents, fetchNodes } from "@/api";
import type { AuditEvent, Node } from "@/types";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, Activity, Copy, Download, Pause, Play } from "lucide-react";

function safeJsonPretty(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const obj = JSON.parse(value);
    return JSON.stringify(obj, null, 2);
  } catch {
    return value;
  }
}

function formatTimestamp(tsUtc: string): string {
  const d = new Date(tsUtc);
  if (Number.isNaN(d.getTime())) return tsUtc;
  return d.toLocaleString();
}

export function AuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const live = (searchParams.get("live") ?? "1") === "1";
  const take = Math.max(1, Math.min(2000, Number(searchParams.get("take") ?? "200") || 200));

  const kind = (searchParams.get("kind") ?? "").trim();
  const category = (searchParams.get("category") ?? "").trim();
  const eventName = (searchParams.get("event") ?? "").trim();
  const nodeId = (searchParams.get("node") ?? "").trim();
  const commandId = (searchParams.get("command") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const v = value.trim();
      if (!v) next.delete(key);
      else next.set(key, v);
      return next;
    });
  };

  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    for (const n of nodesQuery.data ?? []) map.set(n.id, n);
    return map;
  }, [nodesQuery.data]);

  const auditQuery = useQuery({
    queryKey: ["audit-events", { take, kind, category, eventName, nodeId, commandId }],
    queryFn: () =>
      fetchAuditEvents({
        take,
        kind: kind || undefined,
        category: category || undefined,
        eventName: eventName || undefined,
        nodeId: nodeId || undefined,
        commandId: commandId || undefined,
      }),
    refetchInterval: live ? 2_000 : false,
    staleTime: live ? 0 : 2_000,
  });

  const eventsForDisplay = useMemo(() => {
    const raw = (auditQuery.data ?? []).slice();
    // API returns newest-first; render oldest-first for "tail" feel.
    raw.reverse();

    const needle = q.toLowerCase();
    if (!needle) return raw;

    return raw.filter((e) => {
      const hay = [
        e.kind,
        e.eventName,
        e.category ?? "",
        e.message ?? "",
        e.error ?? "",
        e.httpPath ?? "",
        e.hubMethod ?? "",
        e.actorName ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [auditQuery.data, q]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScroll) return;
    if (!live) return;
    const el = scrollRef.current;
    if (!el) return;
    // After a refresh, keep us pinned to the bottom.
    el.scrollTop = el.scrollHeight;
  }, [autoScroll, live, eventsForDisplay.length]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Server Activity & Audit Logs</CardTitle>
          </div>
          <CardDescription>
            Durable server-side audit events (commands, hub calls, HTTP activity, etc.)
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={live ? "default" : "outline"}
            onClick={() => updateParam("live", live ? "0" : "1")}
          >
            {live ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            {live ? "Live" : "Paused"}
          </Button>
          <Button
            variant={autoScroll ? "default" : "outline"}
            onClick={() => setAutoScroll((v) => !v)}
          >
            Auto-scroll: {autoScroll ? "On" : "Off"}
          </Button>
          <Button
            variant="outline"
            onClick={() => auditQuery.refetch()}
            disabled={auditQuery.isFetching}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="q">Search</Label>
            <Input
              id="q"
              placeholder="message, eventName, path, error…"
              value={q}
              onChange={(e) => updateParam("q", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="kind">Kind</Label>
            <Input
              id="kind"
              placeholder='e.g. "activity"'
              value={kind}
              onChange={(e) => updateParam("kind", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              placeholder='e.g. "commands"'
              value={category}
              onChange={(e) => updateParam("category", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="event">Event</Label>
            <Input
              id="event"
              placeholder='e.g. "command.dispatched"'
              value={eventName}
              onChange={(e) => updateParam("event", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Limit</Label>
            <Select
              value={String(take)}
              onValueChange={(v) => updateParam("take", v ?? "200")}
            >
              <SelectTrigger>
                <SelectValue>{take}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[50, 100, 200, 500, 1000, 2000].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 md:col-span-3">
            <Label>Node</Label>
            {nodesQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                value={nodeId}
                onValueChange={(v) => updateParam("node", v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {nodeId ? (nodeMap.get(nodeId)?.hostname ?? nodeId) : "All nodes"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All nodes</SelectItem>
                  {(nodesQuery.data ?? []).map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.hostname} ({n.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="command">CommandId (optional)</Label>
            <Input
              id="command"
              placeholder="GUID"
              value={commandId}
              onChange={(e) => updateParam("command", e.target.value)}
            />
          </div>
        </div>

        {auditQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load audit events</AlertTitle>
            <AlertDescription>
              {auditQuery.error instanceof Error
                ? auditQuery.error.message
                : "Unknown error occurred"}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Showing <span className="font-medium text-foreground">{eventsForDisplay.length}</span> event(s)
          </div>
          <div>
            {auditQuery.isFetching ? "Updating…" : ""}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="rounded-lg border overflow-auto max-h-[70vh]"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Node</TableHead>
                <TableHead>Success</TableHead>
                <TableHead className="w-[55%]">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="py-6">
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!auditQuery.isLoading && eventsForDisplay.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No events match the current filters.
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {eventsForDisplay.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(e)}
                >
                  <TableCell className="font-mono text-xs">{formatTimestamp(e.timestampUtc)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.kind}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.eventName}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.nodeId ? (nodeMap.get(e.nodeId)?.hostname ?? e.nodeId.slice(0, 8)) : "—"}
                  </TableCell>
                  <TableCell>
                    {e.success === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : e.success ? (
                      <Badge>Yes</Badge>
                    ) : (
                      <Badge variant="destructive">No</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {e.message ?? e.error ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">{selected?.eventName}</DialogTitle>
              <DialogDescription>
                {selected ? formatTimestamp(selected.timestampUtc) : ""}
              </DialogDescription>
            </DialogHeader>

            {selected && (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selected.kind}</Badge>
                  {selected.category && <Badge variant="secondary">{selected.category}</Badge>}
                  {selected.source && <Badge variant="secondary">{selected.source}</Badge>}
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Node</div>
                    <div className="font-mono text-xs">
                      {selected.nodeId
                        ? `${nodeMap.get(selected.nodeId)?.hostname ?? ""} ${selected.nodeId}`
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Command</div>
                    <div className="font-mono text-xs">{selected.commandId ?? "—"}</div>
                  </div>
                </div>

                {(selected.message || selected.error) && (
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground mb-1">Message</div>
                    <div className="whitespace-pre-wrap">{selected.message ?? selected.error}</div>
                  </div>
                )}

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Data</div>
                  <pre className="max-h-[40vh] overflow-auto rounded bg-muted p-3 text-xs font-mono whitespace-pre">
                    {safeJsonPretty(selected.dataJson) || "(none)"}
                  </pre>
                </div>

                {(selected.httpMethod || selected.httpPath || selected.httpStatusCode) && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">HTTP</div>
                    <div className="font-mono text-xs">
                      {selected.httpMethod ?? ""} {selected.httpPath ?? ""} {selected.httpStatusCode ?? ""}
                    </div>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    if (!selected) return;
                    await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
                    toast.success("Copied event JSON");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to copy");
                  }
                }}
              >
                <Copy className="h-4 w-4 mr-1" />
                Copy JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!selected) return;
                  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                  const blob = new Blob([JSON.stringify(selected, null, 2)], {
                    type: "application/json;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `audit-event-${stamp}.json`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
