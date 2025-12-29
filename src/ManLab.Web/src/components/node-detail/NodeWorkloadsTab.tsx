import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchNodeCommands, requestDockerContainerList, restartContainer } from "../../api";
import { ContainerList } from "../ContainerList";
import { ServiceMonitoringPanel } from "../ServiceMonitoringPanel";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { Container } from "../../types";

interface NodeWorkloadsTabProps {
  nodeId: string;
  nodeStatus: string;
}

export function NodeWorkloadsTab({ nodeId, nodeStatus }: NodeWorkloadsTabProps) {
  // Fetch command history (used for docker container list)
  const { data: commands } = useQuery({
    queryKey: ["commands", nodeId],
    queryFn: () => fetchNodeCommands(nodeId, 50),
    refetchInterval: 5000,
  });

  const dockerListCommand = (commands ?? []).find(
    (c) => c.commandType === "docker.list" && c.status !== "Failed"
  );
  const latestSuccessfulDockerList = (commands ?? []).find(
    (c) =>
      c.commandType === "docker.list" && c.status === "Success" && !!c.outputLog
  );

  let dockerContainers: Container[] = [];
  let dockerListError: string | null = null;
  
  if (latestSuccessfulDockerList?.outputLog) {
    try {
      let jsonContent = latestSuccessfulDockerList.outputLog;
      const arrayStart = jsonContent.indexOf('[');
      const objectStart = jsonContent.indexOf('{');
      
      let jsonStart = -1;
      if (arrayStart >= 0 && objectStart >= 0) {
        jsonStart = Math.min(arrayStart, objectStart);
      } else if (arrayStart >= 0) {
        jsonStart = arrayStart;
      } else if (objectStart >= 0) {
        jsonStart = objectStart;
      }
      
      if (jsonStart >= 0) {
        jsonContent = jsonContent.substring(jsonStart);
      }
      
      const parsed = JSON.parse(jsonContent);
      if (Array.isArray(parsed)) {
        dockerContainers = parsed as Container[];
      } else if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.error === "string"
      ) {
        dockerListError = parsed.error;
      } else {
        dockerListError = `Unexpected response format.`;
      }
    } catch (e) {
      dockerListError = `Failed to parse docker list output: ${e instanceof Error ? e.message : "Unknown error"}`;
    }
  }

  const isDockerListRunning =
    dockerListCommand?.status === "Queued" ||
    dockerListCommand?.status === "Sent" ||
    dockerListCommand?.status === "InProgress";

  const dockerListMutation = useMutation({
    mutationFn: () => requestDockerContainerList(nodeId),
  });

  const restartMutation = useMutation({
    mutationFn: (containerId: string) => restartContainer(nodeId, containerId),
    onSuccess: () => {
      dockerListMutation.mutate();
    },
  });

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
      {/* Docker Containers */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Docker Containers
          </h2>
          <Button
            variant="outline"
            size="sm"
            disabled={nodeStatus !== "Online" || dockerListMutation.isPending}
            onClick={() => dockerListMutation.mutate()}
          >
            Refresh List
          </Button>
        </div>
        
        {dockerListError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Docker list failed</AlertTitle>
            <AlertDescription>{dockerListError}</AlertDescription>
          </Alert>
        )}
        
        <ContainerList
          containers={dockerContainers}
          isLoading={isDockerListRunning || dockerListMutation.isPending}
          onRestart={async (containerId) => {
            await restartMutation.mutateAsync(containerId);
          }}
        />
        
        {nodeStatus !== "Online" && (
          <p className="text-xs text-muted-foreground mt-3">
            Docker queries are only available when the node is online.
          </p>
        )}
      </section>

      {/* Service Monitoring */}
      <section>
        <ServiceMonitoringPanel nodeId={nodeId} nodeStatus={nodeStatus} />
      </section>
    </div>
  );
}
