/**
 * ArpTableTool Component
 * View and manage the ARP table.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notify } from "@/lib/network-notify";
import {
  addStaticArpEntry,
  deleteArpEntry,
  flushArpCache,
  getArpTable,
  type ArpTableEntry,
} from "@/api/networkApi";
import { useConfirm } from "@/hooks/useConfirm";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const EMPTY_STATE = "No ARP entries found. Try refreshing the table.";

export function ArpTableTool() {
  const [entries, setEntries] = useState<ArpTableEntry[]>([]);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [ipAddress, setIpAddress] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [interfaceName, setInterfaceName] = useState("");

  const loadTable = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getArpTable();
      setEntries(result.entries ?? []);
      setRetrievedAt(result.retrievedAt ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load ARP table";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return entries;

    return entries.filter((entry) => {
      return (
        entry.ipAddress.toLowerCase().includes(query) ||
        entry.macAddress.toLowerCase().includes(query) ||
        (entry.vendor ?? "").toLowerCase().includes(query) ||
        (entry.interfaceName ?? "").toLowerCase().includes(query)
      );
    });
  }, [entries, filter]);

  const counts = useMemo(() => {
    const staticCount = entries.filter((entry) => entry.isStatic === true).length;
    const dynamicCount = entries.filter((entry) => entry.isStatic === false).length;
    const unknownCount = entries.length - staticCount - dynamicCount;
    const ipCounts = entries.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.ipAddress] = (acc[entry.ipAddress] ?? 0) + 1;
      return acc;
    }, {});
    const macCounts = entries.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.macAddress] = (acc[entry.macAddress] ?? 0) + 1;
      return acc;
    }, {});

    return { staticCount, dynamicCount, unknownCount, ipCounts, macCounts };
  }, [entries]);

  const handleAddStatic = useCallback(async () => {
    if (!ipAddress.trim() || !macAddress.trim()) {
      notify.error("IP address and MAC address are required");
      return;
    }

    setIsActionLoading(true);
    try {
      await addStaticArpEntry({
        ipAddress: ipAddress.trim(),
        macAddress: macAddress.trim(),
        interfaceName: interfaceName.trim() || undefined,
      });
      notify.success("Static ARP entry added");
      setIsAddOpen(false);
      setIpAddress("");
      setMacAddress("");
      setInterfaceName("");
      await loadTable();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add ARP entry";
      notify.error(message);
    } finally {
      setIsActionLoading(false);
    }
  }, [interfaceName, ipAddress, macAddress, loadTable]);

  const handleDelete = useCallback(
    async (ip: string) => {
      const confirmed = await confirm({
        title: "Remove ARP Entry",
        description: `Remove ARP entry for ${ip}?`,
        confirmText: "Remove",
        cancelText: "Cancel",
        destructive: true,
      });
      if (!confirmed) return;

      setIsActionLoading(true);
      try {
        await deleteArpEntry(ip);
        notify.success(`Removed ARP entry for ${ip}`);
        await loadTable();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to remove ARP entry";
        notify.error(message);
      } finally {
        setIsActionLoading(false);
      }
    },
    [loadTable, confirm]
  );

  const handleFlush = useCallback(async () => {
    const confirmed = await confirm({
      title: "Flush ARP Cache",
      description: "Flush the ARP cache? This will clear dynamic entries on the server.",
      confirmText: "Flush",
      cancelText: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;

    setIsActionLoading(true);
    try {
      await flushArpCache();
      notify.success("ARP cache flushed");
      await loadTable();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to flush ARP cache";
      notify.error(message);
    } finally {
      setIsActionLoading(false);
    }
  }, [loadTable, confirm]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            ARP Entries
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadTable} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Static
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Static ARP Entry</DialogTitle>
                  <DialogDescription>
                    Create a permanent IP-to-MAC mapping on the server.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="arp-ip">IP Address</Label>
                    <Input
                      id="arp-ip"
                      placeholder="192.168.1.50"
                      value={ipAddress}
                      onChange={(event) => setIpAddress(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="arp-mac">MAC Address</Label>
                    <Input
                      id="arp-mac"
                      placeholder="00:11:22:33:44:55"
                      value={macAddress}
                      onChange={(event) => setMacAddress(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="arp-interface">Interface (optional)</Label>
                    <Input
                      id="arp-interface"
                      placeholder="eth0 or 192.168.1.10"
                      value={interfaceName}
                      onChange={(event) => setInterfaceName(event.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddStatic} disabled={isActionLoading}>
                    {isActionLoading ? "Saving..." : "Add Entry"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="destructive" onClick={handleFlush} disabled={isActionLoading}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Flush Cache
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase text-muted-foreground">Total</div>
              <div className="text-2xl font-semibold">{entries.length}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase text-muted-foreground">Static</div>
              <div className="text-2xl font-semibold">{counts.staticCount}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase text-muted-foreground">Dynamic / Unknown</div>
              <div className="text-2xl font-semibold">
                {counts.dynamicCount + counts.unknownCount}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-muted-foreground">
              {retrievedAt ? `Last updated ${new Date(retrievedAt).toLocaleString()}` : ""}
            </div>
            <div className="w-full md:max-w-xs">
              <Input
                placeholder="Filter by IP, MAC, vendor, or interface..."
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="rounded-lg border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>MAC Address</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Interface</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Loading ARP table...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filteredEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {filter.trim() ? "No entries match your filter." : EMPTY_STATE}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filteredEntries.map((entry) => {
                    const ipDuplicates = (counts.ipCounts[entry.ipAddress] ?? 0) > 1;
                    const macDuplicates = (counts.macCounts[entry.macAddress] ?? 0) > 1;

                    return (
                      <TableRow key={`${entry.ipAddress}-${entry.macAddress}-${entry.interfaceName ?? ""}`}>
                        <TableCell className="font-mono text-xs">
                          {entry.ipAddress}
                          {ipDuplicates && (
                            <Badge variant="destructive" className="ml-2">
                              Duplicate IP
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {entry.macAddress}
                          {macDuplicates && (
                            <Badge variant="destructive" className="ml-2">
                              Duplicate MAC
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{entry.vendor ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.interfaceName ?? "—"}
                        </TableCell>
                        <TableCell>
                          {entry.isStatic === true && (
                            <Badge variant="secondary">Static</Badge>
                          )}
                          {entry.isStatic === false && (
                            <Badge variant="outline">Dynamic</Badge>
                          )}
                          {entry.isStatic == null && (
                            <Badge variant="outline">Unknown</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(entry.ipAddress)}
                            disabled={isActionLoading}
                            aria-label={`Remove ARP entry for ${entry.ipAddress}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => !open && handleCancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState.title}</AlertDialogTitle>
            {confirmState.description && (
              <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>{confirmState.cancelText || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirm}
              className={confirmState.destructive ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              {confirmState.confirmText || "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
