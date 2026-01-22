import {
  Copy,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OpenPort } from "@/api/networkApi";
import { copyToClipboard } from "./network-utils";
import {
  getPortInfo,
  getRiskBgColor,
  getRiskColor,
} from "./port-constants";
import { CategoryIcon } from "./CategoryIcon";

interface PortCardProps {
  port: OpenPort;
  host: string;
}

export function PortCard({ port, host }: PortCardProps) {
  const info = getPortInfo(port);
  const isWebPort = [80, 443, 8080, 8443, 3000, 4000, 5000].includes(port.port);
  const webProtocol = [443, 8443].includes(port.port) ? "https" : "http";

  const handleTestConnection = () => {
    window.open(`${webProtocol}://${host}:${port.port}`, "_blank");
  };

  return (
    <div
      className={`relative p-4 rounded-lg border transition-all hover:shadow-md ${getRiskBgColor(info.risk)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Port Number Badge */}
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-background border font-mono font-bold text-lg">
            {port.port}
          </div>

          {/* Service Info */}
          <div>
            <div className="flex items-center gap-2">
              <CategoryIcon category={info.category} className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{info.serviceName}</span>
              <Badge variant="outline" className="text-xs capitalize">
                {info.category}
              </Badge>
            </div>
            {info.serviceDescription && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {info.serviceDescription}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Risk Indicator */}
          <Tooltip>
            <TooltipTrigger>
              <Badge
                variant="outline"
                className={`capitalize ${getRiskColor(info.risk)}`}
              >
                {info.risk === "critical" ? (
                  <ShieldAlert className="h-3 w-3 mr-1" />
                ) : info.risk === "high" ? (
                  <Shield className="h-3 w-3 mr-1" />
                ) : (
                  <ShieldCheck className="h-3 w-3 mr-1" />
                )}
                {info.risk}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {info.risk === "critical"
                ? "Critical: This service is inherently insecure"
                : info.risk === "high"
                  ? "High: May expose sensitive information"
                  : info.risk === "medium"
                    ? "Medium: Ensure proper authentication"
                    : "Low: Generally safe when configured properly"}
            </TooltipContent>
          </Tooltip>

          {/* Copy Port */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(`${host}:${port.port}`)}
                aria-label="Copy address"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy address</TooltipContent>
          </Tooltip>

          {/* Test Connection (for web ports) */}
          {isWebPort && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleTestConnection}>
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in browser</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}