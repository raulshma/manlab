/**
 * ApmPanel component for displaying Application Performance Monitoring telemetry.
 * Shows response times, error rates, throughput, and database query performance.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  Database, 
  Globe, 
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  Zap,
  Server
} from 'lucide-react';
import type { 
  ApplicationPerformanceTelemetry, 
  ApplicationMetrics, 
  DatabaseMetrics, 
  EndpointMetrics,
  ThroughputMetrics,
  SlowQueryInfo
} from '../types';

interface ApmPanelProps {
  data: ApplicationPerformanceTelemetry | null;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(num: number | null): string {
  if (num === null) return '--';
  if (num < 1000) return num.toFixed(0);
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  return `${(num / 1000000).toFixed(1)}M`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getErrorRateColor(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 10) return 'text-red-600';
  if (rate >= 5) return 'text-orange-500';
  if (rate >= 1) return 'text-amber-500';
  return 'text-green-600';
}

function getResponseTimeColor(ms: number | null): string {
  if (ms === null) return 'text-muted-foreground';
  if (ms >= 5000) return 'text-red-600';
  if (ms >= 2000) return 'text-orange-500';
  if (ms >= 1000) return 'text-amber-500';
  return 'text-green-600';
}

function ThroughputOverview({ throughput }: { throughput: ThroughputMetrics | null }) {
  if (!throughput) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className="p-3 rounded-lg border bg-card text-center">
        <TrendingUp className="w-5 h-5 mx-auto mb-1 text-blue-500" />
        <div className="text-2xl font-bold">{throughput.totalRequestsPerSecond.toFixed(1)}</div>
        <div className="text-xs text-muted-foreground">Requests/sec</div>
      </div>
      <div className="p-3 rounded-lg border bg-card text-center">
        <Zap className="w-5 h-5 mx-auto mb-1 text-amber-500" />
        <div className="text-2xl font-bold">{throughput.peakRequestsPerSecond.toFixed(1)}</div>
        <div className="text-xs text-muted-foreground">Peak RPS</div>
      </div>
      <div className="p-3 rounded-lg border bg-card text-center">
        <Clock className="w-5 h-5 mx-auto mb-1 text-green-500" />
        <div className={`text-2xl font-bold ${getResponseTimeColor(throughput.avgLatencyMs)}`}>
          {formatMs(throughput.avgLatencyMs)}
        </div>
        <div className="text-xs text-muted-foreground">Avg Latency</div>
      </div>
      <div className="p-3 rounded-lg border bg-card text-center">
        <AlertCircle className="w-5 h-5 mx-auto mb-1 text-red-500" />
        <div className={`text-2xl font-bold ${getErrorRateColor(throughput.overallErrorRatePercent)}`}>
          {throughput.overallErrorRatePercent?.toFixed(2) ?? '--'}%
        </div>
        <div className="text-xs text-muted-foreground">Error Rate</div>
      </div>
    </div>
  );
}

function ApplicationCard({ app }: { app: ApplicationMetrics }) {
  return (
    <div className="p-4 rounded-lg border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{app.name}</span>
        </div>
        <Badge variant={app.isHealthy ? "default" : "destructive"} className="text-xs">
          {app.isHealthy ? (
            <><CheckCircle className="w-3 h-3 mr-1" /> Healthy</>
          ) : (
            <><AlertCircle className="w-3 h-3 mr-1" /> Unhealthy</>
          )}
        </Badge>
      </div>

      {app.applicationType && (
        <Badge variant="outline" className="text-xs">{app.applicationType}</Badge>
      )}

      {/* Response Time Stats */}
      <div className="grid grid-cols-5 gap-2 text-xs">
        <div className="text-center">
          <div className="text-muted-foreground">Avg</div>
          <div className={`font-medium ${getResponseTimeColor(app.avgResponseTimeMs)}`}>
            {formatMs(app.avgResponseTimeMs)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">P50</div>
          <div className="font-medium">{formatMs(app.p50ResponseTimeMs)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">P95</div>
          <div className="font-medium">{formatMs(app.p95ResponseTimeMs)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">P99</div>
          <div className="font-medium">{formatMs(app.p99ResponseTimeMs)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Max</div>
          <div className={`font-medium ${getResponseTimeColor(app.maxResponseTimeMs)}`}>
            {formatMs(app.maxResponseTimeMs)}
          </div>
        </div>
      </div>

      {/* Request Stats */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Requests</div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{formatNumber(app.totalRequests)}</span>
            <span className="text-xs text-muted-foreground">
              ({app.requestsPerSecond?.toFixed(1) ?? '--'}/s)
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Error Rate</div>
          <div className={`text-lg font-bold ${getErrorRateColor(app.errorRatePercent)}`}>
            {app.errorRatePercent?.toFixed(2) ?? '--'}%
          </div>
        </div>
      </div>

      {/* Error Breakdown */}
      {(app.clientErrors > 0 || app.serverErrors > 0) && (
        <div className="flex gap-4 text-xs">
          <span className="text-amber-600">4xx: {app.clientErrors}</span>
          <span className="text-red-600">5xx: {app.serverErrors}</span>
          <span className="text-green-600">Success: {app.successfulRequests}</span>
        </div>
      )}

      {/* Resource Usage */}
      {(app.cpuPercent !== null || app.memoryBytes !== null) && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs">
          {app.cpuPercent !== null && (
            <div>
              <span className="text-muted-foreground">CPU:</span>
              <span className="ml-1 font-medium">{app.cpuPercent.toFixed(1)}%</span>
            </div>
          )}
          {app.memoryBytes !== null && (
            <div>
              <span className="text-muted-foreground">Memory:</span>
              <span className="ml-1 font-medium">{formatBytes(app.memoryBytes)}</span>
            </div>
          )}
          {app.activeConnections !== null && (
            <div>
              <span className="text-muted-foreground">Connections:</span>
              <span className="ml-1 font-medium">{app.activeConnections}</span>
            </div>
          )}
          {app.uptimeSeconds !== null && (
            <div>
              <span className="text-muted-foreground">Uptime:</span>
              <span className="ml-1 font-medium">
                {Math.floor(app.uptimeSeconds / 3600)}h {Math.floor((app.uptimeSeconds % 3600) / 60)}m
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DatabaseCard({ db }: { db: DatabaseMetrics }) {
  return (
    <div className="p-4 rounded-lg border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{db.name}</span>
        </div>
        <Badge variant={db.isReachable ? "default" : "destructive"} className="text-xs">
          {db.isReachable ? 'Connected' : 'Unreachable'}
        </Badge>
      </div>

      <div className="flex gap-2">
        {db.databaseType && (
          <Badge variant="outline" className="text-xs">{db.databaseType}</Badge>
        )}
        {db.host && (
          <span className="text-xs text-muted-foreground font-mono">
            {db.host}:{db.port}
          </span>
        )}
      </div>

      {/* Query Stats */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <div className="text-muted-foreground">Queries</div>
          <div className="font-medium">{formatNumber(db.totalQueries)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Avg Time</div>
          <div className={`font-medium ${getResponseTimeColor(db.avgQueryTimeMs)}`}>
            {formatMs(db.avgQueryTimeMs)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">P95</div>
          <div className="font-medium">{formatMs(db.p95QueryTimeMs)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">QPS</div>
          <div className="font-medium">{db.queriesPerSecond?.toFixed(1) ?? '--'}</div>
        </div>
      </div>

      {/* Connection Pool */}
      {db.activeConnections !== null && (
        <div className="pt-2 border-t">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Connection Pool</span>
            <span>{db.activeConnections} / {db.maxConnections ?? '--'}</span>
          </div>
          {db.maxConnections && (
            <Progress 
              value={(db.activeConnections / db.maxConnections) * 100} 
              className="h-1.5" 
            />
          )}
        </div>
      )}

      {/* Failed Queries */}
      {db.failedQueries > 0 && (
        <div className="text-xs text-red-600">
          Failed queries: {db.failedQueries}
        </div>
      )}
    </div>
  );
}

function SlowQueriesTable({ queries }: { queries: SlowQueryInfo[] }) {
  if (!queries || queries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No slow queries recorded
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Query</th>
            <th className="px-3 py-2 text-left">Database</th>
            <th className="px-3 py-2 text-right">Time</th>
            <th className="px-3 py-2 text-right">Rows</th>
            <th className="px-3 py-2 text-left">When</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((query, idx) => (
            <tr key={idx} className="border-t">
              <td className="px-3 py-2 font-mono text-[10px] max-w-[300px] truncate" title={query.query}>
                {query.query}
              </td>
              <td className="px-3 py-2">{query.databaseName || '--'}</td>
              <td className={`px-3 py-2 text-right font-medium ${getResponseTimeColor(query.executionTimeMs)}`}>
                {formatMs(query.executionTimeMs)}
              </td>
              <td className="px-3 py-2 text-right">{query.rowsAffected ?? '--'}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(query.executedAtUtc).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointsTable({ endpoints }: { endpoints: EndpointMetrics[] }) {
  if (!endpoints || endpoints.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No endpoint data available
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Method</th>
            <th className="px-3 py-2 text-left">Path</th>
            <th className="px-3 py-2 text-right">Requests</th>
            <th className="px-3 py-2 text-right">Avg Time</th>
            <th className="px-3 py-2 text-right">P95</th>
            <th className="px-3 py-2 text-right">Error %</th>
            <th className="px-3 py-2 text-right">RPS</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((ep, idx) => (
            <tr key={idx} className="border-t">
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px]">{ep.method}</Badge>
              </td>
              <td className="px-3 py-2 font-mono">{ep.path}</td>
              <td className="px-3 py-2 text-right">{formatNumber(ep.totalRequests)}</td>
              <td className={`px-3 py-2 text-right ${getResponseTimeColor(ep.avgResponseTimeMs)}`}>
                {formatMs(ep.avgResponseTimeMs)}
              </td>
              <td className="px-3 py-2 text-right">{formatMs(ep.p95ResponseTimeMs)}</td>
              <td className={`px-3 py-2 text-right ${getErrorRateColor(ep.errorRatePercent)}`}>
                {ep.errorRatePercent?.toFixed(2) ?? '--'}%
              </td>
              <td className="px-3 py-2 text-right">{ep.requestsPerSecond?.toFixed(1) ?? '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApmPanel({ data }: ApmPanelProps) {
  if (!data) {
    return null;
  }

  const hasApps = data.applications && data.applications.length > 0;
  const hasDatabases = data.databases && data.databases.length > 0;
  const hasEndpoints = data.endpoints && data.endpoints.length > 0;
  const hasThroughput = data.systemThroughput !== null;

  if (!hasApps && !hasDatabases && !hasEndpoints && !hasThroughput) {
    return null;
  }

  // Collect all slow queries from all databases
  const allSlowQueries = data.databases
    ?.flatMap(db => db.slowQueries || [])
    .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
    .slice(0, 10) || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Application Performance Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* System Throughput Overview */}
        <ThroughputOverview throughput={data.systemThroughput} />

        <Tabs defaultValue="applications" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="applications" className="text-xs">
              Applications ({data.applications?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="databases" className="text-xs">
              Databases ({data.databases?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="endpoints" className="text-xs">
              Endpoints ({data.endpoints?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="slow-queries" className="text-xs">
              Slow Queries ({allSlowQueries.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="applications" className="mt-4">
            {hasApps ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.applications.map((app, idx) => (
                  <ApplicationCard key={idx} app={app} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No application data available
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="databases" className="mt-4">
            {hasDatabases ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.databases.map((db, idx) => (
                  <DatabaseCard key={idx} db={db} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No database data available
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="endpoints" className="mt-4">
            <EndpointsTable endpoints={data.endpoints || []} />
          </TabsContent>
          
          <TabsContent value="slow-queries" className="mt-4">
            <SlowQueriesTable queries={allSlowQueries} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
