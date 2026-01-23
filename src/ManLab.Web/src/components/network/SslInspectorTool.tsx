/**
 * SslInspectorTool Component
 * Inspect SSL/TLS certificate chain for a host.
 */

import { useCallback, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/network-notify";
import { inspectCertificate, type SslInspectionResult } from "@/api/networkApi";

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function SslInspectorTool() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("443");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SslInspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const daysBadge = useMemo(() => {
    if (!result) return null;
    if (result.daysRemaining < 0) return { label: "Expired", variant: "destructive" as const };
    if (result.daysRemaining < 30) return { label: `${result.daysRemaining} days`, variant: "secondary" as const };
    return { label: `${result.daysRemaining} days`, variant: "default" as const };
  }, [result]);

  const handleInspect = useCallback(async () => {
    if (!host.trim()) {
      setError("Enter a host to inspect");
      return;
    }

    const parsedPort = Number(port);
    if (!Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      setError("Enter a valid port");
      return;
    }

    setError(null);
    setIsLoading(true);
    setResult(null);

    try {
      const data = await inspectCertificate({ host, port: parsedPort });
      setResult(data);
      notify.success("SSL inspection completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "SSL inspection failed";
      setError(message);
      notify.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [host, port]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          SSL/TLS Certificate Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="ssl-host">Host</Label>
            <Input
              id="ssl-host"
              placeholder="example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="w-28 space-y-2">
            <Label htmlFor="ssl-port">Port</Label>
            <Input
              id="ssl-port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <Button onClick={handleInspect} disabled={isLoading} className="gap-2">
            {isLoading ? "Inspecting..." : "Inspect"}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{result.host}:{result.port}</Badge>
              {daysBadge && <Badge variant={daysBadge.variant}>{daysBadge.label}</Badge>}
              <Badge variant={result.isValidNow ? "default" : "destructive"}>
                {result.isValidNow ? "Valid" : "Invalid"}
              </Badge>
            </div>

            <div className="space-y-3">
              {result.chain.map((cert, index) => (
                <div key={`${cert.thumbprint}-${index}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{index === 0 ? "Leaf" : `Chain ${index + 1}`}</div>
                    {cert.isSelfSigned && <Badge variant="secondary">Self-signed</Badge>}
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
                    <div><span className="font-medium text-foreground">Subject:</span> {cert.subject}</div>
                    <div><span className="font-medium text-foreground">Issuer:</span> {cert.issuer}</div>
                    <div className="flex flex-wrap gap-4">
                      <span><span className="font-medium text-foreground">Not Before:</span> {formatDate(cert.notBefore)}</span>
                      <span><span className="font-medium text-foreground">Not After:</span> {formatDate(cert.notAfter)}</span>
                    </div>
                    {cert.subjectAlternativeNames.length > 0 && (
                      <div>
                        <span className="font-medium text-foreground">SANs:</span> {cert.subjectAlternativeNames.join(", ")}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4">
                      <span><span className="font-medium text-foreground">Signature:</span> {cert.signatureAlgorithm ?? "—"}</span>
                      <span><span className="font-medium text-foreground">Key:</span> {cert.publicKeyAlgorithm ?? "—"} {cert.keySize ? `(${cert.keySize})` : ""}</span>
                    </div>
                    <div><span className="font-medium text-foreground">Thumbprint:</span> {cert.thumbprint}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
