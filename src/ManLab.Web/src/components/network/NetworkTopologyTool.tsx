/**
 * NetworkTopologyTool Component
 * Builds a topology map by combining subnet scan + discovery data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  Network,
  Share2,
  Loader2,
  Settings2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/network-notify";
import { announce } from "@/lib/accessibility";
import { useNetworkToolsOptional } from "@/hooks/useNetworkTools";
import {
  buildNetworkTopology,
  type NetworkTopologyResult,
  type NetworkTopologyNode,
  type NetworkTopologyLink,
} from "@/api/networkApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphRef = any;

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  color: string;
  node: NetworkTopologyNode;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
  kind: string;
}

const TOPOLOGY_CIDR_KEY = "manlab:network:topology:cidr";
const TOPOLOGY_CONCURRENCY_KEY = "manlab:network:topology:concurrency";
const TOPOLOGY_TIMEOUT_KEY = "manlab:network:topology:timeout";
const TOPOLOGY_DISCOVERY_KEY = "manlab:network:topology:discovery";
const TOPOLOGY_DISCOVERY_DURATION_KEY = "manlab:network:topology:discovery-duration";

const KIND_COLORS: Record<string, string> = {
  root: "#64748b",
  subnet: "#3b82f6",
  host: "#22c55e",
  mdns: "#f59e0b",
  upnp: "#a855f7",
};

const KIND_GLYPHS: Record<string, string> = {
  root: "R",
  subnet: "S",
  host: "H",
  mdns: "m",
  upnp: "u",
};

const VENDOR_BADGE: Record<string, { label: string; color: string }> = {
  apple: { label: "A", color: "bg-neutral-900 text-white" },
  synology: { label: "S", color: "bg-orange-500 text-white" },
  ubiquiti: { label: "U", color: "bg-blue-600 text-white" },
  ubnt: { label: "U", color: "bg-blue-600 text-white" },
};

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function isValidCIDR(cidr: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;

  const [ip, prefix] = cidr.split("/");
  const parts = ip.split(".");
  const prefixNum = parseInt(prefix, 10);

  const validIP = parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });

  return validIP && prefixNum >= 16 && prefixNum <= 30;
}

export function NetworkTopologyTool() {
  const networkTools = useNetworkToolsOptional();
  const [cidr, setCidr] = useState(() => getStoredString(TOPOLOGY_CIDR_KEY, ""));
  const [concurrency, setConcurrency] = useState(() => getStoredNumber(TOPOLOGY_CONCURRENCY_KEY, 120));
  const [timeout, setTimeoutMs] = useState(() => getStoredNumber(TOPOLOGY_TIMEOUT_KEY, 750));
  const [includeDiscovery, setIncludeDiscovery] = useState(() => getStoredBoolean(TOPOLOGY_DISCOVERY_KEY, true));
  const [discoveryDuration, setDiscoveryDuration] = useState(() => getStoredNumber(TOPOLOGY_DISCOVERY_DURATION_KEY, 6));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NetworkTopologyResult | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const graphRef = useRef<ForceGraphRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 520 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TOPOLOGY_CIDR_KEY, cidr);
    localStorage.setItem(TOPOLOGY_CONCURRENCY_KEY, String(concurrency));
    localStorage.setItem(TOPOLOGY_TIMEOUT_KEY, String(timeout));
    localStorage.setItem(TOPOLOGY_DISCOVERY_KEY, String(includeDiscovery));
    localStorage.setItem(TOPOLOGY_DISCOVERY_DURATION_KEY, String(discoveryDuration));
  }, [cidr, concurrency, timeout, includeDiscovery, discoveryDuration]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(rect.width - 32, 320),
          height: Math.max(460, Math.min(700, window.innerHeight * 0.6)),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const graphData = useMemo(() => {
    if (!result) return { nodes: [], links: [] as GraphLink[] };

    const nodes = result.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      color: KIND_COLORS[node.kind] ?? "#38bdf8",
      node,
    }));

    const links = result.links.map((link) => ({
      source: link.source,
      target: link.target,
      kind: link.kind,
    }));

    return { nodes, links };
  }, [result]);

  useEffect(() => {
    if (!graphRef.current) return;
    const chargeForce = graphRef.current.d3Force("charge");
    if (chargeForce?.strength) {
      chargeForce.strength(-160);
    }
    const linkForce = graphRef.current.d3Force("link");
    if (linkForce && "distance" in linkForce) {
      (linkForce as { distance: (fn: (link: unknown) => number) => void }).distance((link) => {
        const typed = link as NetworkTopologyLink;
        return typed.kind === "service" ? 32 : 85;
      });
    }
  }, [result]);

  const vendorBadge = useMemo(() => {
    const vendor = selectedNode?.node.vendor?.toLowerCase() ?? "";
    if (!vendor) return null;
    const match = Object.keys(VENDOR_BADGE).find((key) => vendor.includes(key));
    return match ? VENDOR_BADGE[match] : null;
  }, [selectedNode]);

  const handleBuildTopology = useCallback(async () => {
    if (!cidr || !isValidCIDR(cidr)) {
      setValidationError("Please enter a valid CIDR notation (e.g., 192.168.1.0/24)");
      return;
    }

    setValidationError(null);
    setIsLoading(true);
    setError(null);
    setSelectedNode(null);

    try {
      const response = await buildNetworkTopology({
        cidr,
        concurrencyLimit: concurrency,
        timeout,
        includeDiscovery,
        discoveryDurationSeconds: discoveryDuration,
      });
      setResult(response);
      announce(`Topology map built with ${response.summary.hostCount} hosts`);
      notify.success("Topology map built successfully");
      setTimeout(() => graphRef.current?.zoomToFit(400, 50), 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build topology";
      setError(message);
      notify.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [cidr, concurrency, timeout, includeDiscovery, discoveryDuration]);

  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const graphNode = node as GraphNode;
      setSelectedNode(graphNode);
      announce(`Selected ${graphNode.node.label}`);
    },
    []
  );

  const paintNode = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const graphNode = node as GraphNode;
      const isSelected = selectedNode?.id === graphNode.id;
      const size = graphNode.kind === "subnet" ? 9 : graphNode.kind === "root" ? 10 : 6;
      const fontSize = 11 / globalScale;
      const glyph = KIND_GLYPHS[graphNode.kind] ?? "?";

      ctx.beginPath();
      ctx.arc(graphNode.x || 0, graphNode.y || 0, size, 0, 2 * Math.PI);
      ctx.fillStyle = graphNode.color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (globalScale > 0.6) {
        ctx.font = `${Math.max(7, 9 / globalScale)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#0f172a";
        ctx.fillText(glyph, graphNode.x || 0, graphNode.y || 0);
      }

      if (globalScale > 0.8) {
        const label = graphNode.node.kind === "host"
          ? graphNode.node.ipAddress ?? graphNode.label
          : graphNode.label;
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(label || "", graphNode.x || 0, (graphNode.y || 0) + size + 2);
      }
    },
    [selectedNode]
  );

  const zoomIn = useCallback(() => graphRef.current?.zoom(1.4, 300), []);
  const zoomOut = useCallback(() => graphRef.current?.zoom(0.75, 300), []);
  const resetZoom = useCallback(() => graphRef.current?.zoomToFit(400, 50), []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Network Topology Mapper
          </CardTitle>
          <CardDescription>
            Build an interactive topology map using subnet scanning and discovery signals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[1fr_150px_150px_auto]">
            <div className="space-y-2">
              <Label htmlFor="topology-cidr">Subnet (CIDR Notation)</Label>
              <Input
                id="topology-cidr"
                placeholder="e.g., 192.168.1.0/24"
                value={cidr}
                onChange={(event) => {
                  const value = event.target.value;
                  setCidr(value);
                  setValidationError(value && !isValidCIDR(value)
                    ? "Please enter a valid CIDR notation (e.g., 192.168.1.0/24)"
                    : null);
                }}
                className={validationError ? "border-destructive" : undefined}
                disabled={isLoading}
              />
              {validationError && (
                <p className="text-sm text-destructive">{validationError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Concurrency: {concurrency}</Label>
              <Slider
                value={[concurrency]}
                onValueChange={(value) => setConcurrency(Array.isArray(value) ? value[0] : value)}
                min={20}
                max={400}
                step={10}
                disabled={isLoading}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">Parallel pings</p>
            </div>

            <div className="space-y-2">
              <Label>Timeout: {timeout}ms</Label>
              <Slider
                value={[timeout]}
                onValueChange={(value) => setTimeoutMs(Array.isArray(value) ? value[0] : value)}
                min={100}
                max={2000}
                step={100}
                disabled={isLoading}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">Per-host timeout</p>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleBuildTopology}
                disabled={isLoading || !cidr}
                className="w-full lg:w-auto min-h-11"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Building...
                  </>
                ) : (
                  <>
                    <Network className="mr-2 h-4 w-4" />
                    Build Topology
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={includeDiscovery}
                onCheckedChange={setIncludeDiscovery}
                disabled={isLoading}
              />
              <span className="text-sm">Include discovery (mDNS/UPnP)</span>
            </div>
            {includeDiscovery && (
              <div className="flex items-center gap-3">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Duration</span>
                  <Badge variant="secondary">{discoveryDuration}s</Badge>
                </div>
                <Slider
                  value={[discoveryDuration]}
                  onValueChange={(value) => setDiscoveryDuration(Array.isArray(value) ? value[0] : value)}
                  min={2}
                  max={20}
                  step={1}
                  disabled={isLoading}
                  className="w-40"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="py-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Hosts</div>
              <div className="text-2xl font-semibold">{result.summary.hostCount}</div>
              <div className="text-xs text-muted-foreground">Discovery-only: {result.summary.discoveryOnlyHosts}</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Subnets</div>
              <div className="text-2xl font-semibold">{result.summary.subnetCount}</div>
              <div className="text-xs text-muted-foreground">Links: {result.summary.totalLinks}</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">mDNS Services</div>
              <div className="text-2xl font-semibold">{result.summary.mdnsServices}</div>
              <div className="text-xs text-muted-foreground">UPnP: {result.summary.upnpDevices}</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Graph Nodes</div>
              <div className="text-2xl font-semibold">{result.summary.totalNodes}</div>
              <div className="text-xs text-muted-foreground">CIDR: {result.cidr}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              Topology Graph
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} aria-label="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} aria-label="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetZoom} aria-label="Fit to view">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div
              ref={containerRef}
              className="flex-1 bg-slate-950 rounded-lg overflow-hidden relative"
              style={{ minHeight: dimensions.height }}
            >
              {result ? (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={graphData}
                  width={dimensions.width}
                  height={dimensions.height}
                  backgroundColor="#0f172a"
                  nodeCanvasObject={paintNode}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                    ctx.beginPath();
                    ctx.arc(node.x || 0, node.y || 0, 10, 0, 2 * Math.PI);
                    ctx.fillStyle = color;
                    ctx.fill();
                  }}
                  onNodeClick={handleNodeClick}
                  linkColor={(link) => (link as NetworkTopologyLink).kind === "service" ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.2)"}
                  linkWidth={(link) => ((link as NetworkTopologyLink).kind === "service" ? 1.5 : 1)}
                  d3AlphaDecay={0.02}
                  d3VelocityDecay={0.35}
                  cooldownTicks={120}
                  onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Network className="h-10 w-10 mb-3 opacity-50" />
                  <p className="text-sm">Run a topology scan to visualize the network.</p>
                </div>
              )}
            </div>

            {selectedNode && (
              <div className="w-64 shrink-0">
                <Card className="bg-slate-900/50">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <RefreshCw className="h-4 w-4" />
                      Node Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Label</p>
                      <p className="text-sm font-medium wrap-break-word">{selectedNode.node.label}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Kind</p>
                      <Badge variant="secondary">{selectedNode.node.kind}</Badge>
                    </div>
                    {selectedNode.node.ipAddress && (
                      <div>
                        <p className="text-xs text-muted-foreground">IP Address</p>
                        <p className="font-mono text-sm">{selectedNode.node.ipAddress}</p>
                      </div>
                    )}
                    {selectedNode.node.hostname && (
                      <div>
                        <p className="text-xs text-muted-foreground">Hostname</p>
                        <p className="text-sm wrap-break-word">{selectedNode.node.hostname}</p>
                      </div>
                    )}
                    {selectedNode.node.macAddress && (
                      <div>
                        <p className="text-xs text-muted-foreground">MAC Address</p>
                        <p className="font-mono text-sm">{selectedNode.node.macAddress}</p>
                      </div>
                    )}
                    {selectedNode.node.vendor && (
                      <div>
                        <p className="text-xs text-muted-foreground">Vendor</p>
                        <div className="flex items-center gap-2">
                          {vendorBadge && (
                            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold ${vendorBadge.color}`}>
                              {vendorBadge.label}
                            </div>
                          )}
                          <p className="text-sm">{selectedNode.node.vendor}</p>
                        </div>
                      </div>
                    )}
                    {selectedNode.node.deviceType && (
                      <div>
                        <p className="text-xs text-muted-foreground">Device Type</p>
                        <p className="text-sm">{selectedNode.node.deviceType}</p>
                      </div>
                    )}
                    {selectedNode.node.serviceType && (
                      <div>
                        <p className="text-xs text-muted-foreground">Service Type</p>
                        <p className="text-sm">{selectedNode.node.serviceType}</p>
                      </div>
                    )}
                    {selectedNode.node.port !== undefined && selectedNode.node.port !== null && (
                      <div>
                        <p className="text-xs text-muted-foreground">Port</p>
                        <p className="text-sm">{selectedNode.node.port}</p>
                      </div>
                    )}
                    {selectedNode.node.ipAddress && networkTools && (
                      <div className="pt-2 flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => networkTools.quickPing(selectedNode.node.ipAddress!)}
                        >
                          Quick Ping
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => networkTools.quickPortScan(selectedNode.node.ipAddress!)}
                        >
                          Scan Ports
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
