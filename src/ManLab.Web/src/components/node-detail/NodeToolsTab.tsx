import { LogViewerPanel } from "../LogViewerPanel";
import { ScriptRunnerPanel } from "../ScriptRunnerPanel";
import { TerminalPanel } from "../TerminalPanel";
import { NodeCommandsPanel } from "../NodeCommandsPanel";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface NodeToolsTabProps {
  nodeId: string;
  nodeStatus: string;
}

export function NodeToolsTab({ nodeId, nodeStatus }: NodeToolsTabProps) {
  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
      <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Remote Terminal</h2>
          <TerminalPanel nodeId={nodeId} nodeStatus={nodeStatus} />
      </section>

      <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Log Viewer</h2>
          <LogViewerPanel nodeId={nodeId} nodeStatus={nodeStatus} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">File Browser</h2>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Browse files in a dedicated view</div>
              <div className="text-xs text-muted-foreground">
                The file browser is now a full page with a node sidebar.
              </div>
            </div>
            <Link
              to="/files"
              className={cn(buttonVariants({ variant: "default", size: "default" }))}
            >
              <Folder className="h-4 w-4 mr-2" />
              Open File Browser
            </Link>
          </div>
        </div>
      </section>
      
      <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Script Runner</h2>
          <ScriptRunnerPanel nodeId={nodeId} nodeStatus={nodeStatus} />
      </section>

      <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Command History</h2>
          <NodeCommandsPanel nodeId={nodeId} />
      </section>
    </div>
  );
}
