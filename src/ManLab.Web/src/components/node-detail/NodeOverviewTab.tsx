import { useQuery } from "@tanstack/react-query";
import { fetchNodeTelemetry, fetchNodeNetworkTelemetry, fetchNodePingTelemetry, fetchGpuHistory } from "../../api";
import { SystemInfoPanel } from "../SystemInfoPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Clock, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import type { Node } from "../../types";
import { useSignalR } from "../../SignalRContext";

// Local helper to avoid circular dependency
function formatCountdown(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    if (diffMs <= 0) return "now";
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffSeconds < 60) return `in ${diffSeconds}s`;
    if (diffMinutes < 60) return `in ${diffMinutes}m`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `in ${hours}h ${mins}m`;
}

interface NodeOverviewTabProps {
    nodeId: string;
    node: Node;
    onPing: () => void;
    isPingPending: boolean;
}

export function NodeOverviewTab({ nodeId, node, onPing, isPingPending }: NodeOverviewTabProps) {
    const { agentBackoffStatus } = useSignalR();
    const backoffStatus = agentBackoffStatus.get(nodeId);

    // Fetch telemetry history (limited for overview)
    const { data: telemetry } = useQuery({
        queryKey: ["telemetry", nodeId],
        queryFn: () => fetchNodeTelemetry(nodeId, 30),
        refetchInterval: 10000,
    });

    const { data: networkTelemetry } = useQuery({
        queryKey: ["networkTelemetry", nodeId],
        queryFn: () => fetchNodeNetworkTelemetry(nodeId, 60),
        refetchInterval: 10000,
    });

    const { data: pingTelemetry } = useQuery({
        queryKey: ["pingTelemetry", nodeId],
        queryFn: () => fetchNodePingTelemetry(nodeId, 60),
        refetchInterval: 10000,
    });

    const { data: gpuHistory } = useQuery({
        queryKey: ["gpuTelemetry", nodeId],
        queryFn: () => fetchGpuHistory(nodeId, 60),
        refetchInterval: 10000,
    });

    return (
        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Backoff Status Alert */}
            {backoffStatus && (
                <Alert variant="destructive">
                    <Clock className="h-4 w-4" />
                    <AlertTitle>Agent Heartbeat Backoff Active</AlertTitle>
                    <AlertDescription className="flex items-center justify-between">
                        <span>
                            Failed to send {backoffStatus.consecutiveFailures} consecutive heartbeat{backoffStatus.consecutiveFailures !== 1 ? "s" : ""}.
                            Next ping expected{" "}
                            <strong>{formatCountdown(backoffStatus.nextRetryTimeUtc ?? "")}</strong>.
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onPing}
                            disabled={isPingPending}
                            className="ml-4"
                        >
                            {isPingPending ? (
                                <>
                                    <Spinner className="h-4 w-4 mr-2" />
                                    Pinging...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Ping Now
                                </>
                            )}
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            <SystemInfoPanel
                node={node}
                telemetry={telemetry || []}
                networkTelemetry={networkTelemetry || []}
                pingTelemetry={pingTelemetry || []}
                gpuTelemetry={gpuHistory || []}
            />
        </div>
    );
}
