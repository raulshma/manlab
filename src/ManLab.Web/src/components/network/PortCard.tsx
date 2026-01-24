import {
  Copy,
  ExternalLink,
  Radio,
  Route,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Database,
  Terminal,
  Server,
  Mail,
  HardDrive,
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
  getRiskColor,
} from "./port-constants";
import { useNetworkToolsOptional } from "@/hooks/useNetworkTools";
import { motion } from "framer-motion";

interface PortCardProps {
  port: OpenPort;
  host: string;
  index?: number;
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web: Globe,
  database: Database,
  remote: Terminal,
  file: HardDrive,
  mail: Mail,
  other: Server,
};

export function PortCard({ port, host, index = 0 }: PortCardProps) {
  const networkTools = useNetworkToolsOptional();
  const info = getPortInfo(port);
  const isWebPort = [80, 443, 8080, 8443, 3000, 4000, 5000].includes(port.port);
  const webProtocol = [443, 8443].includes(port.port) ? "https" : "http";

  const handleTestConnection = () => {
    window.open(`${webProtocol}://${host}:${port.port}`, "_blank");
  };

  const handlePing = () => {
    if (networkTools) {
      networkTools.quickPing(host);
    }
  };

  const handleTraceroute = () => {
    if (networkTools) {
      networkTools.quickTraceroute(host);
    }
  };

  const hasQuickActions = !!networkTools;
  const riskColor = getRiskColor(info.risk);
  const Icon = CATEGORY_ICONS[info.category] || Server;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -2 }}
      className={`group relative overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm transition-all hover:bg-accent/5 hover:border-border/80 hover:shadow-lg ${
        info.risk === "critical" || info.risk === "high" 
          ? "border-destructive/20 bg-destructive/5" 
          : ""
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            {/* Port Number & Icon */}
            <div className="shrink-0 flex flex-col items-center gap-2">
              <div className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-background/80 border shadow-sm font-mono text-xl font-bold tracking-tight group-hover:border-primary/50 transition-colors">
                {port.port}
              </div>
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider px-1.5 h-5">
                TCP
              </Badge>
            </div>

            {/* Service Info */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded-md ${
                  info.category === 'web' ? 'bg-green-500/10 text-green-500' :
                  info.category === 'database' ? 'bg-blue-500/10 text-blue-500' :
                  info.category === 'remote' ? 'bg-purple-500/10 text-purple-500' :
                  'bg-gray-500/10 text-gray-500'
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <h3 className="font-semibold leading-none">{info.serviceName}</h3>
              </div>
              
              <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                {info.serviceDescription || `Unknown service running on port ${port.port}`}
              </p>

              {/* Badges */}
              <div className="flex items-center gap-2 pt-1">
                 <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="outline" className={`h-5 border-0 bg-opacity-10 px-2 text-[10px] uppercase tracking-wider font-semibold ${riskColor.replace('text-', 'bg-').replace('600', '500/10').replace('700', '500/10')} ${riskColor}`}>
                      {info.risk === "critical" ? <ShieldAlert className="mr-1 h-3 w-3" /> :
                       info.risk === "high" ? <Shield className="mr-1 h-3 w-3" /> :
                       <ShieldCheck className="mr-1 h-3 w-3" />}
                      {info.risk}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Risk Level: <span className="capitalize">{info.risk}</span></p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar - Reveals on Hover (or always visible on mobile) */}
        <div className="mt-4 flex items-center justify-between pt-4 border-t border-border/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
           <div className="flex gap-1">
              {hasQuickActions && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handlePing}>
                        <Radio className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ping Host</TooltipContent>
                  </Tooltip>
                  {/* ... other actions ... */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleTraceroute}>
                        <Route className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Traceroute</TooltipContent>
                  </Tooltip>
                </>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => copyToClipboard(`${host}:${port.port}`)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy Address</TooltipContent>
              </Tooltip>
           </div>

           {isWebPort && (
             <Button variant="default" size="sm" className="h-8 text-xs gap-1.5 rounded-lg shadow-sm" onClick={handleTestConnection}>
               Open <ExternalLink className="h-3 w-3" />
             </Button>
           )}
        </div>
      </div>
    </motion.div>
  );
}