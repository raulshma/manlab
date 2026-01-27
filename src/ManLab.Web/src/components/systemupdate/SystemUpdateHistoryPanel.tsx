import { useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import {
  getSystemUpdateHistory,
  getSystemUpdateDetails,
  approveSystemUpdate,
} from "@/api";
import type { SystemUpdateHistory } from "@/types";

interface SystemUpdateHistoryPanelProps {
  nodeId: string;
}

export function SystemUpdateHistoryPanel({ nodeId }: SystemUpdateHistoryPanelProps) {
  const { data: history, isLoading } = useSWR(
    ["systemUpdateHistory", nodeId],
    () => getSystemUpdateHistory(nodeId, 20)
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-6">Loading update history...</div>;
  }

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">No system update history available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {history.map((update) => (
        <UpdateCard
          key={update.id}
          update={update}
          isExpanded={expandedId === update.id}
          onToggle={() => setExpandedId(expandedId === update.id ? null : update.id)}
          onViewDetails={() => setSelectedId(update.id)}
        />
      ))}

      {selectedId && <UpdateDetailDrawer updateId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

interface UpdateCardProps {
  update: SystemUpdateHistory;
  isExpanded: boolean;
  onToggle: () => void;
  onViewDetails: () => void;
}

function UpdateCard({ update, isExpanded, onToggle, onViewDetails }: UpdateCardProps) {
  const getStatusIcon = () => {
    switch (update.status) {
      case "Completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "Failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "InProgress":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "Pending":
      case "Approved":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = () => {
    const variants: Record<string, string> = {
      Completed: "default",
      Failed: "destructive",
      InProgress: "secondary",
      Pending: "outline",
      Approved: "secondary",
      Cancelled: "secondary",
    };

    return (
      <Badge variant={variants[update.status] || "outline"} className="text-xs">
        {update.status}
      </Badge>
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                {getStatusIcon()}
                <div className="text-left flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">System Update</span>
                    {getStatusBadge()}
                    {update.updateType && (
                      <Badge variant="outline" className="text-xs">
                        {update.updateType}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(update.startedAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm">{update.packages.length} package(s)</div>
                  {update.completedAt && (
                    <div className="text-xs text-muted-foreground">
                      Completed in {Math.round(
                        (new Date(update.completedAt).getTime() - new Date(update.startedAt).getTime()) / 60000
                      )} min
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Packages */}
            {update.packages.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Packages</h4>
                <div className="space-y-1">
                  {update.packages.slice(0, 5).map((pkg, idx) => (
                    <div key={idx} className="text-sm flex items-center justify-between p-2 bg-muted/30 rounded">
                      <span className="font-medium">{pkg.name}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{pkg.version}</span>
                        {pkg.newVersion && <span>→ {pkg.newVersion}</span>}
                        <Badge variant="outline" className="text-xs h-5">
                          {pkg.type}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {update.packages.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center">
                      ... and {update.packages.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Error Message */}
            {update.errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{update.errorMessage}</AlertDescription>
              </Alert>
            )}

            {/* Reboot Status */}
            {update.rebootRequired && (
              <Alert className={update.rebootApproved ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}>
                <RefreshCw className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {update.rebootApproved
                    ? `Reboot approved and executed at ${formatDate(update.rebootedAt)}`
                    : "A system reboot is required but has not been approved yet"}
                </AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={onViewDetails} variant="outline" size="sm">
                View Details & Logs
              </Button>
              {update.status === "Pending" && (
                <Button
                  onClick={() => approveSystemUpdate(update.id)}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                >
                  Approve Update
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

interface UpdateDetailDrawerProps {
  updateId: string;
  onClose: () => void;
}

function UpdateDetailDrawer({ updateId, onClose }: UpdateDetailDrawerProps) {
  const { data: details, isLoading } = useSWR(
    ["systemUpdateDetails", updateId],
    () => getSystemUpdateDetails(updateId)
  );

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-2xl max-h-[80vh] overflow-auto m-4">
          <CardContent className="p-6">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!details) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-auto m-4" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Update Details</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              ×
            </Button>
          </div>
          <CardDescription>
            Update ID: {updateId} | Node: {details.nodeHostname || "Unknown"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="font-medium">{details.status}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Update Type</div>
              <div className="font-medium">{details.updateType || "N/A"}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Started At</div>
              <div className="font-medium">{new Date(details.startedAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Completed At</div>
              <div className="font-medium">
                {details.completedAt ? new Date(details.completedAt).toLocaleString() : "In progress"}
              </div>
            </div>
          </div>

          {/* Output Log */}
          {details.outputLog && (
            <div>
              <h4 className="text-sm font-medium mb-2">Output Log</h4>
              <pre className="text-xs bg-muted p-3 rounded max-h-64 overflow-auto">
                {details.outputLog}
              </pre>
            </div>
          )}

          {/* Error */}
          {details.errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{details.errorMessage}</AlertDescription>
            </Alert>
          )}

          {/* Logs Count */}
          <div className="text-sm text-muted-foreground">
            {details.logCount} log entries available. Use the Log Viewer for detailed logs.
          </div>

          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
