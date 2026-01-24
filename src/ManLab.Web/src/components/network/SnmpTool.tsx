/**
 * SnmpTool Component
 * Provides SNMP GET/WALK/TABLE operations.
 */

import { useCallback, useMemo, useState } from "react";
import { Database, Play, Settings2, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { notify } from "@/lib/network-notify";
import {
  snmpGet,
  snmpTable,
  snmpWalk,
  type SnmpAuthProtocol,
  type SnmpGetResult,
  type SnmpPrivacyProtocol,
  type SnmpTableResult,
  type SnmpVersion,
  type SnmpWalkResult,
} from "@/api/networkApi";

const DEFAULT_PORT = "161";
const DEFAULT_TIMEOUT = "2000";
const DEFAULT_RETRIES = "1";
const DEFAULT_MAX_RESULTS = "500";
const DEFAULT_MAX_RESULTS_PER_COLUMN = "200";

function parseOidList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isValidHost(host: string): boolean {
  if (!host.trim()) return false;
  return true;
}

export function SnmpTool() {
  const [mode, setMode] = useState<"get" | "walk" | "table">("get");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(DEFAULT_PORT);
  const [version, setVersion] = useState<SnmpVersion>("V2c");
  const [community, setCommunity] = useState("public");

  const [v3Username, setV3Username] = useState("");
  const [v3AuthProtocol, setV3AuthProtocol] = useState<SnmpAuthProtocol>("None");
  const [v3AuthPassword, setV3AuthPassword] = useState("");
  const [v3PrivacyProtocol, setV3PrivacyProtocol] = useState<SnmpPrivacyProtocol>("None");
  const [v3PrivacyPassword, setV3PrivacyPassword] = useState("");
  const [v3ContextName, setV3ContextName] = useState("");

  const [getOids, setGetOids] = useState("1.3.6.1.2.1.1.1.0");
  const [walkBaseOid, setWalkBaseOid] = useState("1.3.6.1.2.1.1");
  const [tableColumns, setTableColumns] = useState("1.3.6.1.2.1.2.2.1.2\n1.3.6.1.2.1.2.2.1.8");
  const [tableBaseOid, setTableBaseOid] = useState("");

  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_TIMEOUT);
  const [retries, setRetries] = useState(DEFAULT_RETRIES);
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS);
  const [maxResultsPerColumn, setMaxResultsPerColumn] = useState(DEFAULT_MAX_RESULTS_PER_COLUMN);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [getResult, setGetResult] = useState<SnmpGetResult | null>(null);
  const [walkResult, setWalkResult] = useState<SnmpWalkResult | null>(null);
  const [tableResult, setTableResult] = useState<SnmpTableResult | null>(null);

  const isV3 = version === "V3";

  const commonRequestPayload = useMemo(() => {
    const parsedPort = Number(port);
    const parsedTimeout = Number(timeoutMs);
    const parsedRetries = Number(retries);

    const base = {
      host,
      port: Number.isFinite(parsedPort) ? parsedPort : undefined,
      version,
      timeoutMs: Number.isFinite(parsedTimeout) ? parsedTimeout : undefined,
      retries: Number.isFinite(parsedRetries) ? parsedRetries : undefined,
    };

    if (!isV3) {
      return {
        ...base,
        community: community.trim() || "public",
        v3: undefined,
      };
    }

    return {
      ...base,
      community: undefined,
      v3: {
        username: v3Username.trim(),
        authProtocol: v3AuthProtocol,
        privacyProtocol: v3PrivacyProtocol,
        authPassword: v3AuthPassword.trim() || null,
        privacyPassword: v3PrivacyPassword.trim() || null,
        contextName: v3ContextName.trim() || null,
      },
    };
  }, [community, host, isV3, port, retries, timeoutMs, v3AuthPassword, v3AuthProtocol, v3ContextName, v3PrivacyPassword, v3PrivacyProtocol, v3Username, version]);

  const handleSubmit = useCallback(async () => {
    if (!isValidHost(host)) {
      setError("Enter a valid host");
      return;
    }

    setIsLoading(true);
    setError(null);
    setGetResult(null);
    setWalkResult(null);
    setTableResult(null);

    try {
      if (mode === "get") {
        const oids = parseOidList(getOids);
        if (oids.length === 0) {
          setError("Provide at least one OID for GET");
          return;
        }
        const result = await snmpGet({
          ...commonRequestPayload,
          oids,
        });
        setGetResult(result);
        notify.success(`SNMP GET complete (${result.values.length} values)`);
      } else if (mode === "walk") {
        if (!walkBaseOid.trim()) {
          setError("Provide a base OID for WALK");
          return;
        }
        const result = await snmpWalk({
          ...commonRequestPayload,
          baseOid: walkBaseOid.trim(),
          maxResults: Number.isFinite(Number(maxResults)) ? Number(maxResults) : undefined,
        });
        setWalkResult(result);
        notify.success(`SNMP WALK complete (${result.values.length} values)`);
      } else {
        const columns = parseOidList(tableColumns);
        if (columns.length === 0) {
          setError("Provide at least one column OID for TABLE");
          return;
        }
        const result = await snmpTable({
          ...commonRequestPayload,
          baseOid: tableBaseOid.trim() || null,
          columns,
          maxResultsPerColumn: Number.isFinite(Number(maxResultsPerColumn))
            ? Number(maxResultsPerColumn)
            : undefined,
        });
        setTableResult(result);
        notify.success(`SNMP TABLE complete (${result.rows.length} rows)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "SNMP request failed";
      setError(message);
      notify.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [commonRequestPayload, getOids, host, maxResults, maxResultsPerColumn, mode, tableBaseOid, tableColumns, walkBaseOid]);

  const resultValues = useMemo(() => {
    if (mode === "get") return getResult?.values ?? [];
    if (mode === "walk") return walkResult?.values ?? [];
    return [];
  }, [getResult, mode, walkResult]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            SNMP Query Tool
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="get">GET</TabsTrigger>
              <TabsTrigger value="walk">WALK</TabsTrigger>
              <TabsTrigger value="table">TABLE</TabsTrigger>
            </TabsList>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="snmp-host">Host</Label>
                <Input
                  id="snmp-host"
                  placeholder="192.168.1.1"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp-port">Port</Label>
                <Input
                  id="snmp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp-version">Version</Label>
                <Select value={version} onValueChange={(value) => setVersion(value as SnmpVersion)}>
                  <SelectTrigger id="snmp-version">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="V1">SNMP v1</SelectItem>
                    <SelectItem value="V2c">SNMP v2c</SelectItem>
                    <SelectItem value="V3">SNMP v3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp-timeout">Timeout (ms)</Label>
                <Input
                  id="snmp-timeout"
                  type="number"
                  min={200}
                  max={10000}
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp-retries">Retries</Label>
                <Input
                  id="snmp-retries"
                  type="number"
                  min={0}
                  max={5}
                  value={retries}
                  onChange={(event) => setRetries(event.target.value)}
                />
              </div>
              {!isV3 && (
                <div className="space-y-2">
                  <Label htmlFor="snmp-community">Community</Label>
                  <Input
                    id="snmp-community"
                    placeholder="public"
                    value={community}
                    onChange={(event) => setCommunity(event.target.value)}
                  />
                </div>
              )}
            </div>

            {isV3 && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Settings2 className="h-4 w-4" />
                  SNMPv3 Security
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-user">Username</Label>
                    <Input
                      id="snmp-v3-user"
                      value={v3Username}
                      onChange={(event) => setV3Username(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-context">Context Name</Label>
                    <Input
                      id="snmp-v3-context"
                      value={v3ContextName}
                      onChange={(event) => setV3ContextName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-auth">Auth Protocol</Label>
                    <Select
                      value={v3AuthProtocol}
                      onValueChange={(value) => setV3AuthProtocol(value as SnmpAuthProtocol)}
                    >
                      <SelectTrigger id="snmp-v3-auth">
                        <SelectValue placeholder="Select auth" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="None">None</SelectItem>
                        <SelectItem value="Md5">MD5</SelectItem>
                        <SelectItem value="Sha1">SHA-1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-auth-pass">Auth Password</Label>
                    <Input
                      id="snmp-v3-auth-pass"
                      type="password"
                      value={v3AuthPassword}
                      onChange={(event) => setV3AuthPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-priv">Privacy Protocol</Label>
                    <Select
                      value={v3PrivacyProtocol}
                      onValueChange={(value) => setV3PrivacyProtocol(value as SnmpPrivacyProtocol)}
                    >
                      <SelectTrigger id="snmp-v3-priv">
                        <SelectValue placeholder="Select privacy" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="None">None</SelectItem>
                        <SelectItem value="Des">DES</SelectItem>
                        <SelectItem value="Aes128">AES-128</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="snmp-v3-priv-pass">Privacy Password</Label>
                    <Input
                      id="snmp-v3-priv-pass"
                      type="password"
                      value={v3PrivacyPassword}
                      onChange={(event) => setV3PrivacyPassword(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <TabsContent value="get" className="mt-4">
              <div className="space-y-2">
                <Label htmlFor="snmp-get-oids">OID(s)</Label>
                <Textarea
                  id="snmp-get-oids"
                  value={getOids}
                  onChange={(event) => setGetOids(event.target.value)}
                  placeholder="1.3.6.1.2.1.1.1.0"
                />
                <p className="text-xs text-muted-foreground">
                  Separate OIDs with commas or new lines.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="walk" className="mt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="snmp-walk-base">Base OID</Label>
                  <Input
                    id="snmp-walk-base"
                    value={walkBaseOid}
                    onChange={(event) => setWalkBaseOid(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="snmp-walk-max">Max Results</Label>
                  <Input
                    id="snmp-walk-max"
                    type="number"
                    min={1}
                    max={10000}
                    value={maxResults}
                    onChange={(event) => setMaxResults(event.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="table" className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="snmp-table-base">Base OID (optional)</Label>
                  <Input
                    id="snmp-table-base"
                    value={tableBaseOid}
                    onChange={(event) => setTableBaseOid(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="snmp-table-max">Max Results Per Column</Label>
                  <Input
                    id="snmp-table-max"
                    type="number"
                    min={1}
                    max={5000}
                    value={maxResultsPerColumn}
                    onChange={(event) => setMaxResultsPerColumn(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp-table-columns">Column OIDs</Label>
                <Textarea
                  id="snmp-table-columns"
                  value={tableColumns}
                  onChange={(event) => setTableColumns(event.target.value)}
                  placeholder="1.3.6.1.2.1.2.2.1.2"
                />
                <p className="text-xs text-muted-foreground">
                  Add each column OID on a new line.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <Button onClick={handleSubmit} disabled={isLoading} className="gap-2">
            <Play className="h-4 w-4" />
            {isLoading ? "Running..." : "Run Query"}
          </Button>
        </CardContent>
      </Card>

      {(getResult || walkResult || tableResult) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {mode === "table" ? <TableIcon className="h-5 w-5" /> : <Database className="h-5 w-5" />}
              Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode !== "table" && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{resultValues.length} values</Badge>
                <span>
                  Host: {mode === "get" ? getResult?.host : walkResult?.host}
                </span>
                <span>Port: {mode === "get" ? getResult?.port : walkResult?.port}</span>
                <span>Version: {mode === "get" ? getResult?.version : walkResult?.version}</span>
              </div>
            )}

            {mode === "table" && tableResult && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{tableResult.rows.length} rows</Badge>
                <span>Columns: {tableResult.columns.length}</span>
                <span>Host: {tableResult.host}</span>
                <span>Port: {tableResult.port}</span>
                <span>Version: {tableResult.version}</span>
              </div>
            )}

            {mode !== "table" && (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-60">OID</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-28">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultValues.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No results
                        </TableCell>
                      </TableRow>
                    )}
                    {resultValues.map((value) => (
                      <TableRow key={value.oid}>
                        <TableCell className="font-mono text-xs">{value.oid}</TableCell>
                        <TableCell className="font-mono text-xs">{value.value ?? "—"}</TableCell>
                        <TableCell className="text-xs">{value.dataType ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {mode === "table" && tableResult && (
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Index</TableHead>
                      {tableResult.columns.map((column) => (
                        <TableHead key={column} className="font-mono text-xs">
                          {column}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableResult.rows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={tableResult.columns.length + 1}
                          className="text-center text-muted-foreground"
                        >
                          No rows returned
                        </TableCell>
                      </TableRow>
                    )}
                    {tableResult.rows.map((row) => (
                      <TableRow key={row.index}>
                        <TableCell className="font-mono text-xs">{row.index}</TableCell>
                        {tableResult.columns.map((column) => (
                          <TableCell key={`${row.index}-${column}`} className="font-mono text-xs">
                            {row.values[column] ?? "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
