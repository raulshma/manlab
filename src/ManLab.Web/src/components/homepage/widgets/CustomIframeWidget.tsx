import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Code, ExternalLink } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const CustomIframeWidget = memo(function CustomIframeWidget({ config }: WidgetProps) {
  const iframeUrl = (config.iframeUrl as string) || "";
  const iframeHeight = (config.height as number) || 400;
  const allowFullscreen = (config.allowFullscreen as boolean) ?? false;

  if (!iframeUrl) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Custom Iframe</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <Code className="h-3 w-3" />
              <span>Admin Only Widget</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center h-full text-muted-foreground/70">
            <p className="text-sm">No iframe URL configured</p>
            <p className="text-xs mt-2">Configure this widget to embed external content</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Custom Iframe</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <Code className="h-3 w-3" />
              <span>Admin Only Widget</span>
            </div>
          </div>
          <a
            href={iframeUrl}
            target={allowFullscreen ? "_blank" : "_self"}
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            <span>Open in new tab</span>
          </a>
        </div>
      </CardHeader>
      <CardContent className="p-0 h-full">
        <iframe
          src={iframeUrl}
          className="w-full h-full border-0 rounded-lg"
          style={{ height: `${iframeHeight}px` }}
          allowFullScreen={allowFullscreen}
          title="Custom Content"
        />
      </CardContent>
    </Card>
  );
});
