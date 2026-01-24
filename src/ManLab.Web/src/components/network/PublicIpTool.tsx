"use client";

import { useCallback, useState } from "react";
import { Globe, Loader2, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { notify } from "@/lib/network-notify";
import { copyToClipboard } from "./network-utils";
import { getPublicIp, type PublicIpResult } from "@/api/networkApi";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

interface IpRowProps {
  label: string;
  value: string | null;
  provider: string | null;
}

function IpRow({ label, value, provider }: IpRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {label}
          </Badge>
          {provider && (
            <Badge variant="outline" className="text-xs capitalize">
              {provider}
            </Badge>
          )}
        </div>
        <div className="font-mono text-sm sm:text-base">
          {value ?? "Unavailable"}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => value && copyToClipboard(value)}
        disabled={!value}
        className="gap-2"
      >
        <Copy className="h-4 w-4" />
        Copy
      </Button>
    </div>
  );
}

export function PublicIpTool() {
  const [result, setResult] = useState<PublicIpResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getPublicIp();
      setResult(data);
      notify.success("Public IP lookup completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Public IP lookup failed";
      setError(message);
      notify.error(message);
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-muted-foreground mt-1">
          Discover the server&apos;s external IPv4 and IPv6 addresses.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Public IP Lookup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleLookup} disabled={isLoading} className="gap-2">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Looking up...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Lookup
                </>
              )}
            </Button>
            {result?.retrievedAt && (
              <span className="text-xs text-muted-foreground">
                Retrieved: {formatTimestamp(result.retrievedAt)}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <Separator />
              <IpRow label="IPv4" value={result.ipv4} provider={result.ipv4Provider} />
              <IpRow label="IPv6" value={result.ipv6} provider={result.ipv6Provider} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
