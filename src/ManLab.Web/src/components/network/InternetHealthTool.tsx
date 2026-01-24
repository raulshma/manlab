import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Globe,
  Wifi,
  AlertTriangle,
  Clock,
  ListChecks,
  RefreshCcw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { getInternetHealthSnapshot } from "@/api/networkApi";
import type {
  InternetHealthResult,
  InternetHealthPingSnapshot,
  InternetHealthRequest,
} from "@/api/networkApi";

const DEFAULT_PING_TARGETS = ["8.8.8.8", "1.1.1.1"];
const HISTORY_LIMIT = 120;
const STATS_WINDOW = 20;

interface PingHistoryEntry {
  rttMs: number | null;
  success: boolean;
}

interface InternetHealthHistoryEntry {
  timestampUtc: string;
  pings: Record<string, PingHistoryEntry>;
  dnsDurationMs: number;
  isOnline: boolean;
}

interface OutageEvent {
  startedAtUtc: string;
  endedAtUtc?: string;
}

interface PublicIpChange {
  timestampUtc: string;
  ipv4: string | null;
  ipv6: string | null;
  provider: string | null;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function computeJitter(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((acc, val) => acc + val, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function mapPingSnapshot(snapshot: InternetHealthPingSnapshot): PingHistoryEntry {
  const success = Boolean(snapshot.result?.isSuccess);
  return {
    rttMs: success ? snapshot.result?.roundtripTime ?? null : null,
    success,
  };
}

export function InternetHealthTool() {
  const [targetsInput, setTargetsInput] = useState(DEFAULT_PING_TARGETS.join(", "));
  const [dnsQuery, setDnsQuery] = useState("example.com");
  const [pingTimeoutMs, setPingTimeoutMs] = useState(1000);
  const [pollIntervalMs, setPollIntervalMs] = useState(5000);
  const [publicIpIntervalMs, setPublicIpIntervalMs] = useState(60000);
  const [isRunning, setIsRunning] = useState(true);
  const [history, setHistory] = useState<InternetHealthHistoryEntry[]>([]);
  const [outages, setOutages] = useState<OutageEvent[]>([]);
  const [publicIpHistory, setPublicIpHistory] = useState<PublicIpChange[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<InternetHealthResult | null>(null);

  const lastPublicIpCheckRef = useRef<number>(0);
  const lastOnlineRef = useRef<boolean>(true);
  const outageStartRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const targets = useMemo(() => {
    const parsed = targetsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : DEFAULT_PING_TARGETS;
  }, [targetsInput]);

  const appendHistory = useCallback((entry: InternetHealthHistoryEntry) => {
    setHistory((prev) => {
      const next = [...prev, entry];
      return next.slice(-HISTORY_LIMIT);
    });
  }, []);

  const updateOutageTimeline = useCallback((isOnline: boolean, timestampUtc: string) => {
    const wasOnline = lastOnlineRef.current;
    if (wasOnline && !isOnline) {
      outageStartRef.current = timestampUtc;
    } else if (!wasOnline && isOnline && outageStartRef.current) {
      const startedAt = outageStartRef.current;
      setOutages((prev) => [
        { startedAtUtc: startedAt, endedAtUtc: timestampUtc },
        ...prev,
      ].slice(0, 10));
      outageStartRef.current = null;
    }
    lastOnlineRef.current = isOnline;
  }, []);

  const updatePublicIpHistory = useCallback((snapshot: InternetHealthResult) => {
    if (!snapshot.publicIp?.success || !snapshot.publicIp.result) return;
    const result = snapshot.publicIp.result;
    const ipv4 = result.ipv4 ?? null;
    const ipv6 = result.ipv6 ?? null;
    const provider = result.ipv4Provider ?? result.ipv6Provider ?? null;

    setPublicIpHistory((prev) => {
      const last = prev[0];
      if (last && last.ipv4 === ipv4 && last.ipv6 === ipv6) {
        return prev;
      }
      return [{ timestampUtc: snapshot.timestampUtc, ipv4, ipv6, provider }, ...prev].slice(0, 20);
    });
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    const controller = new AbortController();
    let isMounted = true;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const now = Date.now();
      const includePublicIp = now - lastPublicIpCheckRef.current >= publicIpIntervalMs;

      const request: InternetHealthRequest = {
        pingTargets: targets,
        pingTimeoutMs,
        dnsQuery,
        includePublicIp,
      };

      try {
        const snapshot = await getInternetHealthSnapshot(request, { signal: controller.signal });
        if (!isMounted) return;

        if (includePublicIp) {
          lastPublicIpCheckRef.current = Date.now();
        }

        setLastSnapshot(snapshot);
        updatePublicIpHistory(snapshot);

        const pingMap: Record<string, PingHistoryEntry> = {};
        snapshot.pings.forEach((ping) => {
          pingMap[ping.target] = mapPingSnapshot(ping);
        });

        const isOnline = snapshot.pings.some((ping) => ping.result?.isSuccess);
        const entry: InternetHealthHistoryEntry = {
          timestampUtc: snapshot.timestampUtc,
          pings: pingMap,
          dnsDurationMs: snapshot.dns.durationMs,
          isOnline,
        };

        appendHistory(entry);
        updateOutageTimeline(isOnline, snapshot.timestampUtc);
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Failed to fetch internet health";
        setErrorMessage(message);
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const interval = window.setInterval(tick, pollIntervalMs);

    return () => {
      isMounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [appendHistory, dnsQuery, pingTimeoutMs, pollIntervalMs, publicIpIntervalMs, targets, updateOutageTimeline, updatePublicIpHistory, isRunning]);

  const pingStats = useMemo(() => {
    const recent = history.slice(-STATS_WINDOW);

    return targets.map((target) => {
      const samples = recent.map((entry) => entry.pings[target]).filter(Boolean) as PingHistoryEntry[];
      const total = samples.length;
      const successes = samples.filter((sample) => sample.success).length;
      const lossPercent = total > 0 ? ((total - successes) / total) * 100 : 0;
      const rtts = samples
        .filter((sample) => sample.success && typeof sample.rttMs === "number")
        .map((sample) => sample.rttMs as number);
      const jitter = computeJitter(rtts);
      const latest = samples[samples.length - 1];

      return {
        target,
        total,
        lossPercent,
        jitter,
        latestRtt: latest?.rttMs ?? null,
        latestSuccess: latest?.success ?? false,
      };
    });
  }, [history, targets]);

  const pingChartData = useMemo(() => {
    return history.map((entry) => {
      const row: Record<string, number | string | null> = { time: formatTime(entry.timestampUtc) };
      targets.forEach((target) => {
        row[target] = entry.pings[target]?.rttMs ?? null;
      });
      return row;
    });
  }, [history, targets]);

  const dnsChartData = useMemo(() => {
    return history.map((entry) => ({
      time: formatTime(entry.timestampUtc),
      dnsMs: entry.dnsDurationMs,
    }));
  }, [history]);

  const latestOnline = history.length > 0 ? history[history.length - 1].isOnline : true;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-muted-foreground mt-1">
            Continuous connectivity checks, DNS latency, and public IP change tracking.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={isRunning} onCheckedChange={setIsRunning} />
            <span>{isRunning ? "Monitoring" : "Paused"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              lastPublicIpCheckRef.current = 0;
            }}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Refresh IP
          </Button>
        </div>
      </div>

      {errorMessage && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="py-3 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {errorMessage}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Monitor Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Ping Targets (comma separated)</label>
            <Input value={targetsInput} onChange={(event) => setTargetsInput(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">DNS Query</label>
            <Input value={dnsQuery} onChange={(event) => setDnsQuery(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Ping Timeout (ms)</label>
            <Input
              type="number"
              min={100}
              max={10000}
              value={pingTimeoutMs}
              onChange={(event) => setPingTimeoutMs(Number(event.target.value) || 1000)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Ping/DNS Interval (ms)</label>
            <Input
              type="number"
              min={1000}
              max={60000}
              value={pollIntervalMs}
              onChange={(event) => setPollIntervalMs(Number(event.target.value) || 5000)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Public IP Check Interval (ms)</label>
            <Input
              type="number"
              min={10000}
              max={300000}
              value={publicIpIntervalMs}
              onChange={(event) => setPublicIpIntervalMs(Number(event.target.value) || 60000)}
            />
          </div>
          <div className="flex items-end gap-2">
            <Badge variant={latestOnline ? "secondary" : "destructive"}>
              {latestOnline ? "Online" : "Offline"}
            </Badge>
            {lastSnapshot && (
              <span className="text-xs text-muted-foreground">
                Last updated {formatTime(lastSnapshot.timestampUtc)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {pingStats.map((stat) => (
          <Card key={stat.target} className={stat.latestSuccess ? "" : "border-destructive/40"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wifi className="h-4 w-4 text-primary" />
                {stat.target}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Latest RTT</span>
                <span className="font-mono">
                  {stat.latestRtt !== null ? `${stat.latestRtt}ms` : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Packet Loss</span>
                <span className="font-mono">{stat.lossPercent.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Jitter</span>
                <span className="font-mono">{stat.jitter.toFixed(1)}ms</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Ping Latency History
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pingChartData}>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}ms`} width={45} />
                <RechartsTooltip />
                <Legend />
                {targets.map((target, idx) => (
                  <Line
                    key={target}
                    type="monotone"
                    dataKey={target}
                    strokeWidth={2}
                    stroke={idx % 2 === 0 ? "hsl(var(--primary))" : "#38bdf8"}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              DNS Resolution Time
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dnsChartData}>
                <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}ms`} width={45} />
                <RechartsTooltip />
                <Line type="monotone" dataKey="dnsMs" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              Public IP Change Log
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {publicIpHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No public IP changes recorded yet.</p>
            ) : (
              publicIpHistory.map((entry) => (
                <div key={entry.timestampUtc} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-mono">{entry.ipv4 || entry.ipv6 || "-"}</p>
                    <p className="text-xs text-muted-foreground">{entry.provider || "Unknown provider"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(entry.timestampUtc)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Outage Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {outages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outages detected in recent history.</p>
            ) : (
              outages.map((outage) => (
                <div key={outage.startedAtUtc} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">Outage</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(outage.startedAtUtc)} → {outage.endedAtUtc ? formatTime(outage.endedAtUtc) : "ongoing"}
                    </p>
                  </div>
                  {outage.endedAtUtc && (
                    <Badge variant="outline">{formatDuration(new Date(outage.endedAtUtc).getTime() - new Date(outage.startedAtUtc).getTime())}</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
