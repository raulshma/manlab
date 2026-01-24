/**
 * SubnetCalculatorTool Component
 * Calculate subnet ranges, mask, and usable IPs from CIDR input.
 */

import { useMemo, useState } from "react";
import { Calculator, Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SubnetResult {
  cidr: string;
  networkAddress: string;
  broadcastAddress: string;
  firstUsable: string;
  lastUsable: string;
  subnetMask: string;
  wildcardMask: string;
  totalHosts: number;
  usableHosts: number;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function intToIp(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function maskFromPrefix(prefix: number): number {
  if (prefix <= 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function calculateSubnet(cidr: string): SubnetResult | null {
  const [ipPart, prefixPart] = cidr.split("/");
  const prefix = Number(prefixPart);

  if (!ipPart || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const ipInt = ipToInt(ipPart);
  if (ipInt === null) {
    return null;
  }

  const mask = maskFromPrefix(prefix);
  const wildcard = (~mask) >>> 0;
  const network = ipInt & mask;
  const broadcast = network | wildcard;

  const totalHosts = prefix === 32 ? 1 : Math.pow(2, 32 - prefix);
  let usableHosts = totalHosts;
  let firstUsable = network;
  let lastUsable = broadcast;

  if (prefix <= 30) {
    usableHosts = Math.max(0, totalHosts - 2);
    firstUsable = network + 1;
    lastUsable = broadcast - 1;
  }

  return {
    cidr,
    networkAddress: intToIp(network >>> 0),
    broadcastAddress: intToIp(broadcast >>> 0),
    firstUsable: intToIp(firstUsable >>> 0),
    lastUsable: intToIp(lastUsable >>> 0),
    subnetMask: intToIp(mask),
    wildcardMask: intToIp(wildcard),
    totalHosts,
    usableHosts,
  };
}

export function SubnetCalculatorTool() {
  const [cidr, setCidr] = useState("192.168.1.0/24");

  const result = useMemo(() => calculateSubnet(cidr.trim()), [cidr]);
  const hasError = cidr.trim().length > 0 && !result;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Subnet Calculator</h2>
        <p className="text-muted-foreground mt-1">
          Convert CIDR notation into usable IP ranges and masks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            CIDR Input
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="cidr-input">CIDR Notation</Label>
          <Input
            id="cidr-input"
            placeholder="192.168.1.0/24"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
          />
          {hasError && (
            <div className="text-sm text-destructive">
              Enter a valid IPv4 CIDR like 10.0.0.0/16.
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="h-4 w-4 text-primary" />
                Network Range
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono">{result.networkAddress}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Broadcast</span>
                <span className="font-mono">{result.broadcastAddress}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">First Usable</span>
                <span className="font-mono">{result.firstUsable}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Usable</span>
                <span className="font-mono">{result.lastUsable}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="h-4 w-4 text-primary" />
                Mask & Capacity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subnet Mask</span>
                <span className="font-mono">{result.subnetMask}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Wildcard Mask</span>
                <span className="font-mono">{result.wildcardMask}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Hosts</span>
                <span className="font-mono">{result.totalHosts}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Usable Hosts</span>
                <span className="font-mono">{result.usableHosts}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
