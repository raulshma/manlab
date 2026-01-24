/**
 * MacVendorLookupTool Component
 * Lookup device manufacturer by MAC address.
 */

import { useCallback, useMemo, useState } from "react";
import { Fingerprint, Loader2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/network-notify";
import { lookupMacVendor, type MacVendorLookupResult } from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";

function normalizeMacAddress(input: string): string | null {
  const cleaned = input
    .replace(/[:\-.]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(cleaned)) {
    return null;
  }

  return cleaned.match(/.{2}/g)?.join(":") ?? null;
}

export function MacVendorLookupTool() {
  const { isConnected, lookupMacVendor: lookupMacVendorHub } = useNetworkHub();
  const [macAddress, setMacAddress] = useState("");
  const [result, setResult] = useState<MacVendorLookupResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const normalizedMac = useMemo(() => normalizeMacAddress(macAddress), [macAddress]);

  const handleLookup = useCallback(async () => {
    if (!normalizedMac) {
      notify.error("Enter a valid MAC address");
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      if (isConnected) {
        const hubResult = await lookupMacVendorHub(normalizedMac);
        setResult(hubResult);
      } else {
        const apiResult = await lookupMacVendor({ macAddress: normalizedMac });
        setResult(apiResult);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lookup failed";
      notify.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [normalizedMac, isConnected, lookupMacVendorHub]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">MAC Vendor Lookup</h2>
        <p className="text-muted-foreground mt-1">
          Identify device manufacturers by MAC address prefixes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            Lookup Vendor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mac-lookup">MAC Address</Label>
            <Input
              id="mac-lookup"
              placeholder="00:11:22:33:44:55"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
            />
            {normalizedMac && (
              <div className="text-xs text-muted-foreground font-mono">
                Normalized: {normalizedMac}
              </div>
            )}
          </div>

          <Button onClick={handleLookup} disabled={isLoading || !normalizedMac}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Looking up
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4 mr-2" />
                Lookup Vendor
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="font-mono">
                {result.macAddress}
              </Badge>
              <Badge variant={result.vendor ? "default" : "outline"}>
                {result.vendor ?? "Unknown vendor"}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Database entries: {result.vendorCount}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
