import { LogViewerPanel } from "../LogViewerPanel";
import { ScriptRunnerPanel } from "../ScriptRunnerPanel";
import { TerminalPanel } from "../TerminalPanel";
import { NodeCommandsPanel } from "../NodeCommandsPanel";

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
