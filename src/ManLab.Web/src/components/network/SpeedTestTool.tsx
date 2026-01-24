"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Download, Upload, Activity, Settings2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Separator } from "@/components/ui/separator";
import { notify } from "@/lib/network-notify";
import {
  runSpeedTest,
  type SpeedTestMetadata,
  type SpeedTestProgress,
  type SpeedTestResult,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { motion, AnimatePresence } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";

const SPEED_DL_KEY = "manlab:network:speedtest-download-mb";
const SPEED_UL_KEY = "manlab:network:speedtest-upload-mb";
const SPEED_LAT_KEY = "manlab:network:speedtest-latency-samples";

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMbps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

// --- Visual Components ---

const SpeedGauge = ({ value, max = 100, label, color = "text-primary" }: { value: number; max?: number; label: string; color?: string }) => {
  // Simple semi-circle gauge using SVG
  const radius = 80;
  const stroke = 12;
  const normalizedValue = Math.min(value, max);
  const circumference = radius * 2 * Math.PI;
  const strokeDasharray = `${circumference} ${circumference}`;
  const strokeDashoffset = circumference - (normalizedValue / max) * (circumference / 2);

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <div className="relative h-48 w-48 flex items-center justify-center overflow-hidden">
        <svg height="100%" width="100%" viewBox="0 0 200 200" className="transform rotate-180">
          <circle
            stroke="currentColor"
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            style={{ strokeDashoffset: circumference / 2 }}
            r={radius}
            cx="100"
            cy="100"
            className="text-muted/20"
          />
          <circle
            stroke="currentColor"
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={strokeDasharray}
            style={{ strokeDashoffset, transition: "stroke-dashoffset 0.5s ease-out" }}
            strokeLinecap="round"
            r={radius}
            cx="100"
            cy="100"
            className={cn("transition-all duration-500", color)}
          />
        </svg>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-4 text-center flex flex-col items-center z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            key={value}
            className="text-5xl font-black tracking-tighter"
          >
            {value.toFixed(0)}
          </motion.div>
          <span className="text-sm text-muted-foreground font-medium">Mbps</span>
        </div>
      </div>
      <div className="-mt-10 font-medium text-muted-foreground uppercase tracking-widest text-xs">
        {label}
      </div>
    </div>
  );
};

const LiveChart = ({ data, color }: { data: { value: number }[]; color: string }) => {
  return (
    <div className="h-15 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 'auto']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${color})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

// --- Main Component ---

export function SpeedTestTool() {
  // State
  const [downloadMb, setDownloadMb] = useState(() => getStoredNumber(SPEED_DL_KEY, 10));
  const [uploadMb, setUploadMb] = useState(() => getStoredNumber(SPEED_UL_KEY, 5));
  const [latencySamples, setLatencySamples] = useState(() => getStoredNumber(SPEED_LAT_KEY, 3));
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [liveDownload, setLiveDownload] = useState<SpeedTestProgress | null>(null);
  const [liveUpload, setLiveUpload] = useState<SpeedTestProgress | null>(null);
  const [liveLatency, setLiveLatency] = useState<SpeedTestProgress | null>(null);
  const [metadata, setMetadata] = useState<SpeedTestMetadata | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Chart Data State
  const [chartData, setChartData] = useState<{ value: number }[]>([]);

  const completedRef = useRef(false);
  const { isConnected, runSpeedTest: runSpeedTestRealtime, subscribeToSpeedTest } = useNetworkHub();

  // Persist settings
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SPEED_DL_KEY, String(downloadMb));
    localStorage.setItem(SPEED_UL_KEY, String(uploadMb));
    localStorage.setItem(SPEED_LAT_KEY, String(latencySamples));
  }, [downloadMb, uploadMb, latencySamples]);

  // Handle Updates
  useEffect(() => {
    return subscribeToSpeedTest({
      onSpeedTestStarted: (event) => {
        completedRef.current = false;
        setStartedAt(event.startedAt ?? null);
        setMetadata(null);
        setLiveDownload(null);
        setLiveUpload(null);
        setLiveLatency(null);
        setChartData([]);
        setResult(null);
      },
      onSpeedTestProgress: (event) => {
        const update = event.update;
        if (update.metadata) setMetadata(update.metadata);
        if (update.progress) {
          const p = update.progress;
          if (p.phase === "download") {
            setLiveDownload(p);
            if (p.mbps) setChartData(prev => [...prev.slice(-20), { value: p.mbps! }]);
          } else if (p.phase === "upload") {
            setLiveUpload(p);
            if (p.mbps) setChartData(prev => [...prev.slice(-20), { value: p.mbps! }]);
          } else if (p.phase === "latency") {
            setLiveLatency(p);
          }
        }
      },
      onSpeedTestCompleted: (event) => {
        completedRef.current = true;
        setResult(event.result);
        setIsRunning(false);
        if (!event.result.success) {
          notify.error(event.result.error ?? "Speed test failed");
        } else {
          notify.success("Speed test completed");
        }
      },
      onSpeedTestFailed: (event) => {
        completedRef.current = true;
        setIsRunning(false);
        notify.error(event.error ?? "Speed test failed");
      },
    });
  }, [subscribeToSpeedTest]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setShowSettings(false);
    setChartData([]); // Reset chart
    
    const request = {
      downloadSizeBytes: Math.max(1, downloadMb) * 1_000_000,
      uploadSizeBytes: Math.max(1, uploadMb) * 1_000_000,
      latencySamples: Math.max(1, Math.min(10, latencySamples)),
    };

    try {
      if (isConnected) {
        // Realtime via SignalR
        const data = await runSpeedTestRealtime(request);
        // Fallback result setting if not handled by event (though event usually handles it)
        if (!completedRef.current) {
           // wait a bit for events? SignalR usually sends completion event.
           // But if we get a direct return, we can set it.
           if (data) setResult(data);
        }
      } else {
        // REST fallback
        const data = await runSpeedTest(request);
        setResult(data);
        if(!data.success) notify.error(data.error ?? "Speed test failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speed test failed";
      notify.error(message);
      setIsRunning(false);
    }
  }, [downloadMb, uploadMb, latencySamples, isConnected, runSpeedTestRealtime]);

  // Derived state for phases
  const currentPhase = useMemo(() => {
    if (liveUpload) return "upload";
    if (liveDownload) return "download";
    if (liveLatency) return "latency";
    return "idle";
  }, [liveDownload, liveUpload, liveLatency]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Next-Gen Network Performance Analyzer
          </p>
        </div>
        {!isRunning && (
            <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowSettings(!showSettings)}
                className="gap-2"
            >
                <Settings2 className="w-4 h-4" />
                Configure
                {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
        )}
      </div>

      {/* Settings Panel (Collapsible) */}
      <AnimatePresence>
        {showSettings && !isRunning && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="border-dashed">
              <CardContent className="grid gap-6 pt-6 md:grid-cols-3">
                 <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Download Size (MB)</Label>
                    <Input type="number" min={1} max={100} value={downloadMb} onChange={(e) => setDownloadMb(Number(e.target.value))} />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Upload Size (MB)</Label>
                    <Input type="number" min={1} max={100} value={uploadMb} onChange={(e) => setUploadMb(Number(e.target.value))} />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Latency Samples</Label>
                    <Input type="number" min={1} max={10} value={latencySamples} onChange={(e) => setLatencySamples(Number(e.target.value))} />
                 </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Stage */}
      <div className="relative min-h-100 flex flex-col items-center justify-center">
         <AnimatePresence mode="wait">
            
            {/* IDLE STATE */}
            {!isRunning && !result && (
                <motion.div
                    key="idle"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-center justify-center gap-8 py-12"
                >
                    <div className="relative group">
                        <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                        <Button 
                            onClick={handleRun} 
                            size="lg" 
                            className="relative h-32 w-32 rounded-full text-2xl font-black tracking-tight border-8 border-primary/10 hover:border-primary/30 shadow-2xl hover:scale-105 transition-all duration-300"
                        >
                            GO
                        </Button>
                    </div>
                    <div className="flex gap-8 text-sm text-muted-foreground text-center">
                        <div>
                            <span className="block font-bold text-foreground text-lg">{downloadMb} MB</span>
                            Download
                        </div>
                         <Separator orientation="vertical" className="h-10" />
                        <div>
                            <span className="block font-bold text-foreground text-lg">{uploadMb} MB</span>
                            Upload
                        </div>
                    </div>
                </motion.div>
            )}

            {/* RUNNING STATE */}
            {isRunning && (
                <motion.div
                    key="running"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full flex flex-col items-center gap-8"
                >
                    {/* Active Gauge */}
                    <div className="relative">
                        {currentPhase === "download" && (
                            <SpeedGauge value={liveDownload?.mbps ?? 0} max={100} label="Download" color="text-emerald-500" />
                        )}
                        {currentPhase === "upload" && (
                             <SpeedGauge value={liveUpload?.mbps ?? 0} max={50} label="Upload" color="text-indigo-500" />
                        )}
                        {currentPhase === "latency" && (
                             <div className="h-48 w-48 flex flex-col items-center justify-center border-4 border-muted rounded-full relative">
                                 <Activity className="w-12 h-12 text-primary animate-pulse" />
                                 <div className="mt-2 text-2xl font-bold">{liveLatency?.latencySampleMs?.toFixed(0) ?? "--"} <span className="text-sm font-normal text-muted-foreground">ms</span></div>
                                 <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">Ping</div>
                             </div>
                        )}
                         {/* Loading spinner for init/other phases */}
                        {currentPhase === "idle" && (
                             <div className="h-48 w-48 flex items-center justify-center">
                                 <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                             </div>
                        )}
                    </div>

                    {/* Live Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full max-w-2xl">
                        <Card className={cn("transition-colors", currentPhase === "download" ? "border-emerald-500/50 bg-emerald-500/5" : "bg-card/50")}>      
                            <CardContent className="p-4 text-center">
                                <div className="text-xs uppercase text-muted-foreground mb-1">Download</div>
                                <div className="text-xl font-mono font-bold">
                                    {liveDownload ? formatMbps(liveDownload.mbps) : formatMbps(result?.downloadMbps ?? null)}
                                </div>
                                <div className="h-10 mt-2">
                                    {currentPhase === "download" && <LiveChart data={chartData} color="#10b981" />}
                                </div>
                            </CardContent>
                        </Card>
                         <Card className={cn("transition-colors", currentPhase === "upload" ? "border-indigo-500/50 bg-indigo-500/5" : "bg-card/50")}> 
                            <CardContent className="p-4 text-center">
                                <div className="text-xs uppercase text-muted-foreground mb-1">Upload</div>
                                <div className="text-xl font-mono font-bold">
                                    {liveUpload ? formatMbps(liveUpload.mbps) : formatMbps(result?.uploadMbps ?? null)}
                                </div>
                                 <div className="h-10 mt-2">
                                    {currentPhase === "upload" && <LiveChart data={chartData} color="#6366f1" />}
                                </div>
                            </CardContent>
                        </Card>
                         <Card className={cn("transition-colors", currentPhase === "latency" ? "border-primary/50 bg-primary/5" : "bg-card/50")}> 
                            <CardContent className="p-4 text-center">
                                <div className="text-xs uppercase text-muted-foreground mb-1">Ping</div>
                                <div className="text-xl font-mono font-bold">
                                    {liveLatency?.latencySampleMs?.toFixed(0) ?? (result?.latencyAvgMs?.toFixed(0) ?? "—")}
                                </div>
                                <div className="text-xs text-muted-foreground mt-2">
                                    {liveLatency ? `${liveLatency.latencySamplesCollected}/${latencySamples}` : "Samples"}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </motion.div>
            )}

            {/* RESULTS STATE */}
            {result && !isRunning && (
                 <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="w-full space-y-8"
                >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Download Result */}
                         <Card className="relative overflow-hidden border-emerald-500/20">
                            <div className="absolute inset-0 bg-linear-to-br from-emerald-500/10 to-transparent pointer-events-none" />
                            <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
                                    <Download className="h-6 w-6 text-emerald-500" />
                                </span>
                                <div className="text-4xl font-black text-foreground tracking-tighter">
                                    {formatMbps(result.downloadMbps)}
                                </div>
                                <div className="text-sm font-medium text-emerald-500 uppercase tracking-widest mt-1">Download</div>
                                <div className="text-xs text-muted-foreground mt-4 font-mono">{formatBytes(result.downloadBytes)} transferred</div>
                            </CardContent>
                         </Card>

                         {/* Upload Result */}
                         <Card className="relative overflow-hidden border-indigo-500/20">
                            <div className="absolute inset-0 bg-linear-to-br from-indigo-500/10 to-transparent pointer-events-none" />
                            <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 mb-4">
                                    <Upload className="h-6 w-6 text-indigo-500" />
                                </span>
                                <div className="text-4xl font-black text-foreground tracking-tighter">
                                    {formatMbps(result.uploadMbps)}
                                </div>
                                <div className="text-sm font-medium text-indigo-500 uppercase tracking-widest mt-1">Upload</div>
                                <div className="text-xs text-muted-foreground mt-4 font-mono">{formatBytes(result.uploadBytes)} transferred</div>
                            </CardContent>
                         </Card>

                         {/* Latency Result */}
                         <Card className="relative overflow-hidden border-primary/20">
                            <div className="absolute inset-0 bg-linear-to-br from-primary/10 to-transparent pointer-events-none" />
                            <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                                    <Activity className="h-6 w-6 text-primary" />
                                </span>
                                <div className="text-4xl font-black text-foreground tracking-tighter">
                                    {result.latencyAvgMs?.toFixed(0) ?? "0"}
                                    <span className="text-lg text-muted-foreground font-normal ml-1">ms</span>
                                </div>
                                <div className="text-sm font-medium text-primary uppercase tracking-widest mt-1">Latency</div>
                                <div className="flex gap-2 text-xs text-muted-foreground mt-4 font-mono">
                                    <span>Jitter {result.jitterMs?.toFixed(1) ?? "-"}ms</span>
                                    <span>·</span>
                                    <span>Min {result.latencyMinMs?.toFixed(1) ?? "-"}ms</span>
                                </div>
                            </CardContent>
                         </Card>
                    </div>

                    <div className="flex justify-center">
                        <Button onClick={handleRun} size="lg" className="rounded-full px-8 gap-2 shadow-lg hover:shadow-primary/25 transition-all">
                             <RefreshCw className="w-4 h-4" />
                             Test Again
                        </Button>
                    </div>
                
                 </motion.div>
            )}

         </AnimatePresence>
      </div>

       {/* Detailed Metadata Footer - Always shown if data exists, nicely styled */}
       {(metadata || result) && (
        <motion.div
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }}
            className="w-full"
        >
            <Separator className="my-8" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 text-xs text-muted-foreground">
                <div className="space-y-4">
                     <div>
                        <div className="font-semibold text-foreground mb-1">Client</div>
                        <div className="font-mono">{metadata?.clientName ?? result?.clientName ?? "Unknown"}</div>
                        <div>{metadata?.clientVersion ?? result?.clientVersion}</div>
                     </div>
                     <div>
                        <div className="font-semibold text-foreground mb-1">Library</div>
                        <div className="font-mono">{metadata?.clientLibraryName ?? "ManLab Bandwidth"}</div>
                     </div>
                </div>
                 <div className="space-y-4">
                     <div>
                        <div className="font-semibold text-foreground mb-1">Server</div>
                        <div className="font-mono">{metadata?.serviceName ?? result?.serviceName ?? "SpeedTest"}</div>
                        <div>{metadata?.serviceType ?? result?.serviceType}</div>
                     </div>
                </div>
                <div className="space-y-4">
                     <div>
                        <div className="font-semibold text-foreground mb-1">Time</div>
                        <div className="grid gap-1 font-mono">
                            <div className="flex justify-between gap-4">
                                <span>Start</span>
                                <span>{formatTimestamp(startedAt ?? result?.startedAt ?? null)}</span>
                            </div>
                            {result?.completedAt && (
                                <div className="flex justify-between gap-4">
                                    <span>End</span>
                                    <span>{formatTimestamp(result.completedAt)}</span>
                                </div>
                            )}
                        </div>
                     </div>
                </div>
                 <div className="space-y-4 lg:col-span-2">
                     <div>
                        <div className="font-semibold text-foreground mb-1">Endpoints</div>
                        <div className="grid gap-2 font-mono break-all">
                            {metadata?.downloadUrl && (
                                <div className="flex gap-2">
                                    <span className="text-emerald-500">DL</span>
                                    {metadata.downloadUrl}
                                </div>
                            )}
                             {metadata?.uploadUrl && (
                                <div className="flex gap-2">
                                    <span className="text-indigo-500">UL</span>
                                    {metadata.uploadUrl}
                                </div>
                            )}
                        </div>
                     </div>
                </div>
            </div>
        </motion.div>
       )}
    </div>
  );
}
