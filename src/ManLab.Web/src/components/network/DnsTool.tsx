/**
 * DnsTool Component
 * Provides DNS record lookup and WHOIS information.
 */

import { useCallback, useMemo, useState } from "react";
import { Activity, Globe, Search, BookText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/network-notify";
import {
  dnsLookup,
  dnsPropagationCheck,
  whoisLookup,
  type DnsLookupResult,
  type DnsPropagationResult,
  type DnsRecordType,
  type WhoisResult,
} from "@/api/networkApi";

function isValidQuery(value: string): boolean {
  if (!value.trim()) return false;
  return true;
}

function formatTtl(ttl?: number | null): string {
  if (!ttl) return "—";
  return `${ttl}s`;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const defaultPropagationTypes: DnsRecordType[] = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SOA",
];

const allowedPropagationTypes = new Set<DnsRecordType>([
  ...defaultPropagationTypes,
  "PTR",
  "SRV",
  "CAA",
]);

export function DnsTool() {
  const [query, setQuery] = useState("");
  const [includeReverse, setIncludeReverse] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isWhoisLoading, setIsWhoisLoading] = useState(false);
  const [result, setResult] = useState<DnsLookupResult | null>(null);
  const [whoisResult, setWhoisResult] = useState<WhoisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propagationServers, setPropagationServers] = useState("");
  const [propagationTypes, setPropagationTypes] = useState("");
  const [includeDefaultServers, setIncludeDefaultServers] = useState(true);
  const [isPropagationLoading, setIsPropagationLoading] = useState(false);
  const [propagationResult, setPropagationResult] = useState<DnsPropagationResult | null>(null);

  const recordCount = useMemo(() => result?.records.length ?? 0, [result]);

  const handleLookup = useCallback(async () => {
    if (!isValidQuery(query)) {
      setError("Enter a hostname or IP address");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setWhoisResult(null);

    try {
      const data = await dnsLookup({ query, includeReverse });
      setResult(data);
      notify.success(`DNS lookup completed (${data.records.length} records)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "DNS lookup failed";
      setError(message);
      notify.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [includeReverse, query]);

  const handleWhois = useCallback(async () => {
    if (!isValidQuery(query)) {
      setError("Enter a hostname or IP address");
      return;
    }

    setIsWhoisLoading(true);
    setError(null);
    try {
      const data = await whoisLookup({ query });
      setWhoisResult(data);
      notify.success("WHOIS lookup completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "WHOIS lookup failed";
      setError(message);
      notify.error(message);
    } finally {
      setIsWhoisLoading(false);
    }
  }, [query]);

  const handlePropagationCheck = useCallback(async () => {
    if (!isValidQuery(query)) {
      setError("Enter a hostname to check propagation");
      return;
    }

    const servers = parseCsv(propagationServers);
    const typesInput = parseCsv(propagationTypes).map((value) => value.toUpperCase());

    const invalidTypes = typesInput.filter(
      (value) => !allowedPropagationTypes.has(value as DnsRecordType)
    );

    if (invalidTypes.length > 0) {
      setError(`Unsupported record type(s): ${invalidTypes.join(", ")}`);
      return;
    }

    const recordTypes = (typesInput.length > 0
      ? (typesInput as DnsRecordType[])
      : undefined);

    setIsPropagationLoading(true);
    setError(null);
    setPropagationResult(null);

    try {
      const data = await dnsPropagationCheck({
        query,
        servers: servers.length > 0 ? servers : undefined,
        recordTypes,
        includeDefaultServers,
      });
      setPropagationResult(data);
      notify.success(`Propagation check complete (${data.servers.length} resolvers)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Propagation check failed";
      setError(message);
      notify.error(message);
    } finally {
      setIsPropagationLoading(false);
    }
  }, [includeDefaultServers, propagationServers, propagationTypes, query]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            DNS & Domain Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="dns-query">Hostname or IP</Label>
              <Input
                id="dns-query"
                placeholder="example.com or 192.168.1.1"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="dns-reverse"
                checked={includeReverse}
                onCheckedChange={setIncludeReverse}
              />
              <Label htmlFor="dns-reverse">Reverse lookup</Label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleLookup} disabled={isLoading} className="gap-2">
                <Search className="h-4 w-4" />
                {isLoading ? "Looking up..." : "Lookup"}
              </Button>
              <Button
                variant="outline"
                onClick={handleWhois}
                disabled={isWhoisLoading}
                className="gap-2"
              >
                <BookText className="h-4 w-4" />
                {isWhoisLoading ? "Fetching..." : "WHOIS"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{recordCount} records</Badge>
                <span>Query: {result.query}</span>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-24">TTL</TableHead>
                      <TableHead className="w-20">Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.records.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No records found
                        </TableCell>
                      </TableRow>
                    )}
                    {result.records.map((record, index) => (
                      <TableRow key={`${record.type}-${record.name}-${record.value}-${index}`}>
                        <TableCell className="font-mono text-xs">{record.type}</TableCell>
                        <TableCell className="font-mono text-xs">{record.name}</TableCell>
                        <TableCell className="font-mono text-xs">{record.value}</TableCell>
                        <TableCell className="text-xs">{formatTtl(record.ttl)}</TableCell>
                        <TableCell className="text-xs">{record.priority ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {result.reverseRecords.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Reverse DNS</div>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>PTR</TableHead>
                          <TableHead className="w-24">TTL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.reverseRecords.map((record, index) => (
                          <TableRow key={`${record.name}-${record.value}-${index}`}>
                            <TableCell className="font-mono text-xs">{record.name}</TableCell>
                            <TableCell className="font-mono text-xs">{record.value}</TableCell>
                            <TableCell className="text-xs">{formatTtl(record.ttl)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          {whoisResult && (
            <div className="space-y-2">
              <div className="text-sm font-medium">WHOIS ({whoisResult.server ?? "unknown"})</div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
                {whoisResult.response}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            DNS Propagation Checker
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="dns-propagation-types">Record types</Label>
              <Input
                id="dns-propagation-types"
                placeholder={defaultPropagationTypes.join(", ")}
                value={propagationTypes}
                onChange={(e) => setPropagationTypes(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="dns-propagation-servers">DNS servers (optional)</Label>
              <Input
                id="dns-propagation-servers"
                placeholder="8.8.8.8, 1.1.1.1"
                value={propagationServers}
                onChange={(e) => setPropagationServers(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="dns-propagation-defaults"
                checked={includeDefaultServers}
                onCheckedChange={setIncludeDefaultServers}
              />
              <Label htmlFor="dns-propagation-defaults">Use defaults</Label>
            </div>
            <Button
              onClick={handlePropagationCheck}
              disabled={isPropagationLoading}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              {isPropagationLoading ? "Checking..." : "Check"}
            </Button>
          </div>

          {propagationResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{propagationResult.servers.length} resolvers</Badge>
                <span>Query: {propagationResult.query}</span>
              </div>
              <div className="space-y-3">
                {propagationResult.servers.map((server) => (
                  <div key={server.server} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{server.server}</span>
                      {server.resolvedAddress && (
                        <Badge variant="outline" className="text-xs">
                          {server.resolvedAddress}
                        </Badge>
                      )}
                      <span className="text-muted-foreground">{server.durationMs}ms</span>
                    </div>
                    {server.error ? (
                      <div className="text-sm text-red-600 dark:text-red-400">{server.error}</div>
                    ) : (
                      <div className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-28">Type</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Value</TableHead>
                              <TableHead className="w-24">TTL</TableHead>
                              <TableHead className="w-20">Priority</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {server.records.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground">
                                  No records found
                                </TableCell>
                              </TableRow>
                            )}
                            {server.records.map((record, index) => (
                              <TableRow key={`${server.server}-${record.type}-${record.name}-${index}`}>
                                <TableCell className="font-mono text-xs">{record.type}</TableCell>
                                <TableCell className="font-mono text-xs">{record.name}</TableCell>
                                <TableCell className="font-mono text-xs">{record.value}</TableCell>
                                <TableCell className="text-xs">{formatTtl(record.ttl)}</TableCell>
                                <TableCell className="text-xs">{record.priority ?? "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
