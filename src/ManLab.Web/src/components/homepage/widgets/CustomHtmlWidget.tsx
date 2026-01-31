import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Code } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const CustomHtmlWidget = memo(function CustomHtmlWidget({ config }: WidgetProps) {
  const htmlContent = (config.htmlContent as string) || "";

  return (
    <div className="h-full">
      <Card className="border h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Custom HTML</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                <Code className="h-3 w-3" />
                <span>Admin Only Widget</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {htmlContent ? (
            <div 
              className="prose prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground/70">
              <p className="text-sm">No HTML content configured</p>
              <p className="text-xs mt-2">Configure this widget to display custom HTML</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
