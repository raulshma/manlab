/**
 * SpeedTestTool Component
 * Runs a server-side internet speed test.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Loader2, Download, Upload, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/network-notify";
import {
  runSpeedTest,
  type SpeedTestMetadata,
  type SpeedTestProgress,
  type SpeedTestResult,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";

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
  return `${value.toFixed(2)} Mbps`;
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

export function SpeedTestTool() {
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
  const [lastError, setLastError] = useState<string | null>(null);
  const completedRef = useRef(false);
  const { isConnected, runSpeedTest: runSpeedTestRealtime, subscribeToSpeedTest } = useNetworkHub();

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SPEED_DL_KEY, String(downloadMb));
    localStorage.setItem(SPEED_UL_KEY, String(uploadMb));
    localStorage.setItem(SPEED_LAT_KEY, String(latencySamples));
  }, [downloadMb, uploadMb, latencySamples]);

  useEffect(() => {
    return subscribeToSpeedTest({
      onSpeedTestStarted: (event) => {
        completedRef.current = false;
        setStartedAt(event.startedAt ?? null);
        setMetadata(null);
        setLiveDownload(null);
        setLiveUpload(null);
        setLiveLatency(null);
        setLastError(null);
      },
      onSpeedTestProgress: (event) => {
        const update = event.update;
        if (update.metadata) {
          setMetadata(update.metadata);
        }
        if (update.progress) {
          if (update.progress.phase === "download") {
            setLiveDownload(update.progress);
          } else if (update.progress.phase === "upload") {
            setLiveUpload(update.progress);
          } else if (update.progress.phase === "latency") {
            setLiveLatency(update.progress);
          }
        }
      },
      onSpeedTestCompleted: (event) => {
        completedRef.current = true;
        setResult(event.result);
        setMetadata({
          downloadSizeBytes: event.result.downloadSizeBytes,
          uploadSizeBytes: event.result.uploadSizeBytes,
          latencySamples: event.result.latencySamples,
          locateUrl: event.result.locateUrl,
          downloadUrl: event.result.downloadUrl,
          uploadUrl: event.result.uploadUrl,
          serviceName: event.result.serviceName,
          serviceType: event.result.serviceType,
          clientName: event.result.clientName,
          clientVersion: event.result.clientVersion,
          clientLibraryName: event.result.clientLibraryName,
          clientLibraryVersion: event.result.clientLibraryVersion,
        });
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
        setLastError(event.error ?? "Speed test failed");
        notify.error(event.error ?? "Speed test failed");
      },
    });
  }, [subscribeToSpeedTest]);

  const durationSeconds = useMemo(() => {
    if (!result?.durationMs) return null;
    return (result.durationMs / 1000).toFixed(1);
  }, [result]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResult(null);
    setMetadata(null);
    setLiveDownload(null);
    setLiveUpload(null);
    setLiveLatency(null);
    setLastError(null);
    completedRef.current = false;

    const request = {
      downloadSizeBytes: Math.max(1, downloadMb) * 1_000_000,
      uploadSizeBytes: Math.max(1, uploadMb) * 1_000_000,
      latencySamples: Math.max(1, Math.min(10, latencySamples)),
    };

    try {
      if (isConnected) {
        const data = await runSpeedTestRealtime(request);
        if (!completedRef.current) {
          setResult(data);
          if (!data.success) {
            notify.error(data.error ?? "Speed test failed");
          } else {
            notify.success("Speed test completed");
          }
        }
      } else {
        const data = await runSpeedTest(request);
        setResult(data);

        if (!data.success) {
          notify.error(data.error ?? "Speed test failed");
        } else {
          notify.success("Speed test completed");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speed test failed";
      notify.error(message);
    } finally {
      setIsRunning(false);
    }
  }, [downloadMb, uploadMb, latencySamples, isConnected, runSpeedTestRealtime]);

  const liveDownloadPercent = useMemo(() => {
    if (!liveDownload || !liveDownload.targetBytes) return 0;
    return Math.min(100, (liveDownload.bytesTransferred / liveDownload.targetBytes) * 100);
  }, [liveDownload]);

  const liveUploadPercent = useMemo(() => {
    if (!liveUpload || !liveUpload.targetBytes) return 0;
    return Math.min(100, (liveUpload.bytesTransferred / liveUpload.targetBytes) * 100);
  }, [liveUpload]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Internet Speed Test</h2>
        <p className="text-muted-foreground mt-1">
          Measure server-side download, upload, and latency to the public internet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Test Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="speed-download">Download Size (MB)</Label>
            <Input
              id="speed-download"
              type="number"
              min={1}
              max={100}
              value={downloadMb}
              onChange={(e) => setDownloadMb(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="speed-upload">Upload Size (MB)</Label>
            <Input
              id="speed-upload"
              type="number"
              min={1}
              max={100}
              value={uploadMb}
              onChange={(e) => setUploadMb(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="speed-latency">Latency Samples</Label>
            <Input
              id="speed-latency"
              type="number"
              min={1}
              max={10}
              value={latencySamples}
              onChange={(e) => setLatencySamples(Number(e.target.value))}
            />
          </div>
          <div className="md:col-span-3">
            <Button onClick={handleRun} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running speed test
                </>
              ) : (
                <>
                  <Gauge className="h-4 w-4 mr-2" />
                  Run Speed Test
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(isRunning || liveDownload || liveUpload || liveLatency) && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Download className="h-4 w-4 text-primary" />
                Live Download
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatMbps(liveDownload?.mbps ?? null)}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatBytes(liveDownload?.bytesTransferred)} of {formatBytes(liveDownload?.targetBytes)}
              </div>
              <div className="h-2 w-full rounded bg-muted">
                <div
                  className="h-2 rounded bg-primary transition-all"
                  style={{ width: `${liveDownloadPercent}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Upload className="h-4 w-4 text-primary" />
                Live Upload
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatMbps(liveUpload?.mbps ?? null)}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatBytes(liveUpload?.bytesTransferred)} of {formatBytes(liveUpload?.targetBytes)}
              </div>
              <div className="h-2 w-full rounded bg-muted">
                <div
                  className="h-2 rounded bg-primary transition-all"
                  style={{ width: `${liveUploadPercent}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-primary" />
                Live Latency
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {liveLatency?.latencySampleMs?.toFixed(1) ?? "—"} ms
              </div>
              <div className="text-xs text-muted-foreground">
                samples {liveLatency?.latencySamplesCollected ?? 0} / {liveLatency?.latencySamplesTarget ?? latencySamples}
              </div>
              <Badge variant="secondary">Live</Badge>
            </CardContent>
          </Card>
        </div>
      )}

      {result && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Download className="h-4 w-4 text-primary" />
                Download
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatMbps(result.downloadMbps)}
              </div>
              <Badge variant="secondary">{(result.downloadBytes / 1_000_000).toFixed(1)} MB</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Upload className="h-4 w-4 text-primary" />
                Upload
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatMbps(result.uploadMbps)}
              </div>
              <Badge variant="secondary">{(result.uploadBytes / 1_000_000).toFixed(1)} MB</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-primary" />
                Latency
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {result.latencyAvgMs?.toFixed(1) ?? "—"} ms
              </div>
              <div className="text-xs text-muted-foreground">
                min {result.latencyMinMs?.toFixed(1) ?? "—"} · max {result.latencyMaxMs?.toFixed(1) ?? "—"} · jitter {result.jitterMs?.toFixed(1) ?? "—"}
              </div>
              {durationSeconds && (
                <Badge variant="outline">Duration {durationSeconds}s</Badge>
              )}
            </CardContent>
          </Card>

          {!result.success && result.error && (
            <Card className="md:col-span-3 border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm text-destructive">
                {result.error}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {(metadata || result || startedAt || lastError) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Speed Test Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Started</span>
                <span>{formatTimestamp(result?.startedAt ?? startedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Completed</span>
                <span>{formatTimestamp(result?.completedAt ?? null)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Download Size</span>
                <span>{formatBytes(metadata?.downloadSizeBytes ?? result?.downloadSizeBytes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Upload Size</span>
                <span>{formatBytes(metadata?.uploadSizeBytes ?? result?.uploadSizeBytes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Latency Samples</span>
                <span>{metadata?.latencySamples ?? result?.latencySamples ?? "—"}</span>
              </div>
              {lastError && (
                <div className="flex items-center justify-between text-destructive">
                  <span>Last Error</span>
                  <span className="text-right">{lastError}</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Service</span>
                <span>
                  {metadata?.serviceName ?? result?.serviceName ?? "—"} {metadata?.serviceType ?? result?.serviceType ?? ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Client</span>
                <span>
                  {metadata?.clientName ?? result?.clientName ?? "—"}
                  {metadata?.clientVersion || result?.clientVersion
                    ? ` (${metadata?.clientVersion ?? result?.clientVersion})`
                    : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Library</span>
                <span>
                  {metadata?.clientLibraryName ?? result?.clientLibraryName ?? "—"}
                  {metadata?.clientLibraryVersion || result?.clientLibraryVersion
                    ? ` (${metadata?.clientLibraryVersion ?? result?.clientLibraryVersion})`
                    : ""}
                </span>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Locate URL</div>
                <div className="truncate" title={metadata?.locateUrl ?? result?.locateUrl ?? ""}>
                  {metadata?.locateUrl ?? result?.locateUrl ?? "—"}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Download URL</div>
                <div className="truncate" title={metadata?.downloadUrl ?? result?.downloadUrl ?? ""}>
                  {metadata?.downloadUrl ?? result?.downloadUrl ?? "—"}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Upload URL</div>
                <div className="truncate" title={metadata?.uploadUrl ?? result?.uploadUrl ?? ""}>
                  {metadata?.uploadUrl ?? result?.uploadUrl ?? "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
