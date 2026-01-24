/**
 * Network Map View Component
 * Interactive force-directed graph visualization of discovered network hosts.
 * Features: subnet clustering, click-to-select, pan/zoom, and PNG/SVG export.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Network,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCcw,
  Info,
  Database,
  X,
} from "lucide-react";
import type { DiscoveredHost, GeoDatabaseStatus } from "@/api/networkApi";
import {
  getGeolocationStatus,
  downloadGeolocationDatabase,
} from "@/api/networkApi";
import { announce } from "@/lib/accessibility";

// Types for force graph - using simple object types for library compat
interface GraphNode {
  id: string;
  label: string;
  group: string;
  host: DiscoveredHost;
  color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphRef = any;

// Color palette for different subnets
const SUBNET_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
];

// Get subnet key from IP address
function getSubnetKey(ip: string): string {
  const parts = ip.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip;
}

// Get color for a subnet
function getSubnetColor(subnet: string, subnetMap: Map<string, number>): string {
  if (!subnetMap.has(subnet)) {
    subnetMap.set(subnet, subnetMap.size);
  }
  return SUBNET_COLORS[subnetMap.get(subnet)! % SUBNET_COLORS.length];
}

interface NetworkMapViewProps {
  hosts: DiscoveredHost[];
  onHostSelect?: (host: DiscoveredHost | null) => void;
}

export function NetworkMapView({ hosts, onHostSelect }: NetworkMapViewProps) {
  const graphRef = useRef<ForceGraphRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [geoStatus, setGeoStatus] = useState<GeoDatabaseStatus | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Fetch geolocation database status
  useEffect(() => {
    getGeolocationStatus()
      .then(setGeoStatus)
      .catch((err) => console.error("Failed to fetch geo status:", err));
  }, []);

  // Handle container resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(rect.width - 32, 300),
          height: Math.max(400, Math.min(600, window.innerHeight * 0.5)),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Build graph data from hosts
  const graphData = useMemo<GraphData>(() => {
    if (hosts.length === 0) {
      return { nodes: [], links: [] };
    }

    const subnetMap = new Map<string, number>();
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const subnetCenters = new Map<string, string>();

    // Create nodes for each host
    hosts.forEach((host) => {
      const subnet = getSubnetKey(host.ipAddress);
      const color = getSubnetColor(subnet, subnetMap);

      nodes.push({
        id: host.ipAddress,
        label: host.hostname || host.ipAddress,
        group: subnet,
        host,
        color,
      });

      // First host in each subnet becomes the "center"
      if (!subnetCenters.has(subnet)) {
        subnetCenters.set(subnet, host.ipAddress);
      } else {
        // Link hosts to their subnet center for clustering
        links.push({
          source: subnetCenters.get(subnet)!,
          target: host.ipAddress,
        });
      }
    });

    return { nodes, links };
  }, [hosts]);

  // Node click handler
  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const graphNode = node as GraphNode;
      setSelectedNode(graphNode);
      onHostSelect?.(graphNode.host);
      announce(`Selected host ${graphNode.host.ipAddress}`);
    },
    [onHostSelect]
  );

  // Canvas node paint function
  const paintNode = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const graphNode = node as GraphNode;
      const isSelected = selectedNode?.id === graphNode.id;
      const size = isSelected ? 8 : 6;
      const fontSize = 11 / globalScale;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(graphNode.x || 0, graphNode.y || 0, size, 0, 2 * Math.PI);
      ctx.fillStyle = graphNode.color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Draw label if zoomed in enough
      if (globalScale > 0.8) {
        const label = graphNode.host.hostname
          ? graphNode.host.hostname.split(".")[0]
          : graphNode.id.split(".").pop();
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.8)";
        ctx.fillText(label || "", graphNode.x || 0, (graphNode.y || 0) + size + 2);
      }
    },
    [selectedNode]
  );

  // Export to PNG
  const exportToPng = useCallback(() => {
    if (!graphRef.current) return;

    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `network-map-${new Date().toISOString().split("T")[0]}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    announce("Network map exported to PNG");
  }, []);

  // Export to SVG (simplified - creates basic SVG from node data)
  const exportToSvg = useCallback(() => {
    if (!graphData.nodes.length) return;

    const width = dimensions.width;
    const height = dimensions.height;
    const padding = 50;

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graphData.nodes.forEach((node) => {
      if (node.x !== undefined && node.y !== undefined) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
      }
    });

    const scaleX = (width - 2 * padding) / (maxX - minX || 1);
    const scaleY = (height - 2 * padding) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svg += `<rect width="100%" height="100%" fill="#0f172a"/>`;

    // Draw links
    graphData.links.forEach((link) => {
      const sourceNode = graphData.nodes.find((n) => n.id === link.source);
      const targetNode = graphData.nodes.find((n) => n.id === link.target);
      if (sourceNode?.x !== undefined && sourceNode?.y !== undefined && 
          targetNode?.x !== undefined && targetNode?.y !== undefined) {
        const x1 = padding + (sourceNode.x - minX) * scale;
        const y1 = padding + (sourceNode.y - minY) * scale;
        const x2 = padding + (targetNode.x - minX) * scale;
        const y2 = padding + (targetNode.y - minY) * scale;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
      }
    });

    // Draw nodes
    graphData.nodes.forEach((node) => {
      if (node.x !== undefined && node.y !== undefined) {
        const x = padding + (node.x - minX) * scale;
        const y = padding + (node.y - minY) * scale;
        svg += `<circle cx="${x}" cy="${y}" r="6" fill="${node.color}"/>`;
        svg += `<text x="${x}" y="${y + 16}" font-size="10" fill="white" text-anchor="middle">${node.host.ipAddress.split(".").pop()}</text>`;
      }
    });

    svg += `</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `network-map-${new Date().toISOString().split("T")[0]}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    announce("Network map exported to SVG");
  }, [graphData, dimensions]);

  // Zoom controls
  const zoomIn = useCallback(() => graphRef.current?.zoom(1.5, 400), []);
  const zoomOut = useCallback(() => graphRef.current?.zoom(0.75, 400), []);
  const resetZoom = useCallback(() => {
    graphRef.current?.zoomToFit(400, 50);
  }, []);

  // Handle database download
  const handleDownloadDb = useCallback(async () => {
    setDownloading(true);
    try {
      const result = await downloadGeolocationDatabase();
      if (result.success) {
        const status = await getGeolocationStatus();
        setGeoStatus(status);
        announce("Geolocation database downloaded successfully");
      }
    } catch (err) {
      console.error("Failed to download geo database:", err);
    } finally {
      setDownloading(false);
    }
  }, []);

  // Get unique subnets for legend
  const subnets = useMemo(() => {
    const subnetMap = new Map<string, { count: number; color: string }>();
    hosts.forEach((host) => {
      const subnet = getSubnetKey(host.ipAddress);
      if (!subnetMap.has(subnet)) {
        const colorMap = new Map<string, number>();
        const color = getSubnetColor(subnet, colorMap);
        subnetMap.set(subnet, { count: 1, color });
      } else {
        subnetMap.get(subnet)!.count++;
      }
    });
    return Array.from(subnetMap.entries());
  }, [hosts]);

  if (hosts.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-muted-foreground">
          <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No hosts discovered yet.</p>
          <p className="text-sm mt-1">
            Run a subnet scan to visualize your network topology.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Geolocation Database Status */}
      {geoStatus && !geoStatus.isAvailable && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="font-medium text-sm">
                    IP Geolocation Database Not Installed
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Download the database to enable geographic location lookups (~20MB)
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleDownloadDb}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download Database
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              Network Topology Map
              <Badge variant="secondary" className="ml-2">
                {hosts.length} hosts
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={zoomIn}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={zoomOut}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={resetZoom}
                title="Fit to view"
                aria-label="Fit graph to view"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={exportToPng}
                title="Export as PNG"
                aria-label="Export network map as PNG"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex gap-4">
            {/* Graph Container */}
            <div
              ref={containerRef}
              className="flex-1 bg-slate-950 rounded-lg overflow-hidden relative"
              style={{ minHeight: dimensions.height }}
            >
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
                linkColor={() => "rgba(255,255,255,0.15)"}
                linkWidth={1}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                cooldownTicks={100}
                onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
              />

              {/* Subnet Legend */}
              {subnets.length > 0 && (
                <div className="absolute bottom-3 left-3 bg-slate-900/90 rounded-lg p-2 backdrop-blur-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Subnets
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {subnets.slice(0, 6).map(([subnet, { count, color }]) => (
                      <div
                        key={subnet}
                        className="flex items-center gap-2 text-xs"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-mono text-muted-foreground">
                          {subnet}
                        </span>
                        <span className="text-muted-foreground/60">
                          ({count})
                        </span>
                      </div>
                    ))}
                    {subnets.length > 6 && (
                      <p className="text-xs text-muted-foreground/60">
                        +{subnets.length - 6} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Selected Node Details */}
            {selectedNode && (
              <div className="w-64 shrink-0">
                <Card className="bg-slate-900/50">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        Host Details
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          setSelectedNode(null);
                          onHostSelect?.(null);
                        }}
                        aria-label="Close host details"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">IP Address</p>
                      <p className="font-mono text-sm">
                        {selectedNode.host.ipAddress}
                      </p>
                    </div>
                    {selectedNode.host.hostname && (
                      <div>
                        <p className="text-xs text-muted-foreground">Hostname</p>
                        <p className="text-sm truncate">
                          {selectedNode.host.hostname}
                        </p>
                      </div>
                    )}
                    {selectedNode.host.macAddress && (
                      <div>
                        <p className="text-xs text-muted-foreground">MAC Address</p>
                        <p className="font-mono text-sm">
                          {selectedNode.host.macAddress}
                        </p>
                      </div>
                    )}
                    {selectedNode.host.vendor && (
                      <div>
                        <p className="text-xs text-muted-foreground">Vendor</p>
                        <p className="text-sm">{selectedNode.host.vendor}</p>
                      </div>
                    )}
                    {selectedNode.host.deviceType && (
                      <div>
                        <p className="text-xs text-muted-foreground">Device Type</p>
                        <p className="text-sm">{selectedNode.host.deviceType}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Response Time</p>
                      <p className="text-sm">{selectedNode.host.roundtripTime}ms</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Subnet</p>
                      <Badge
                        variant="secondary"
                        className="font-mono text-xs"
                        style={{ borderColor: selectedNode.color }}
                      >
                        {selectedNode.group}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={exportToPng}>
          <Download className="h-4 w-4 mr-2" />
          Export PNG
        </Button>
        <Button variant="outline" size="sm" onClick={exportToSvg}>
          <Download className="h-4 w-4 mr-2" />
          Export SVG
        </Button>
      </div>
    </div>
  );
}
