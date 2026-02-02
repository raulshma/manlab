import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NatsPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [key, setKey] = useState(0);

  // We assume port 14222 as configured in AppHost
  const natsUiUrl = `${window.location.protocol}//${window.location.hostname}:14222`;

  const handleRefresh = () => {
    setKey((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-full gap-1 min-h-0">
      <Card className="flex-1 flex flex-col border-none shadow-none bg-transparent min-h-0 pt-0 pb-0">
        <CardHeader className="px-0 pt-0 pb-0 flex flex-row items-center justify-between space-y-0 shrink-0">
          <div>
            <CardTitle>NATS Console</CardTitle>
            <CardDescription>
              Direct access to the NATS UI (NUI). Connection: <code>nats://nats:4222</code>
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload IFrame
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open(natsUiUrl, '_blank')}>
              Open in New Tab <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 border rounded-lg overflow-hidden bg-background relative selection:bg-none min-h-0">
            {/* Overlay hint if needed, but NUI is standard HTML */}
            <iframe 
                key={key}
                ref={iframeRef}
                src={natsUiUrl} 
                className="w-full h-full border-none block"
                title="NATS UI"
            />
        </CardContent>
      </Card>
    </div>
  );
}
