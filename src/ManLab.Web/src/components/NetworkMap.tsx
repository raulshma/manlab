import { useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Server, 
  Laptop,
  TerminalSquare
} from "lucide-react";
import { Node } from "../types";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NetworkMapProps {
  nodes: Node[];
  onNodeSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
}



interface NodeWithPosition extends Node {
  x: number;
  y: number;
}

// Simple deterministic hash for consistent node positioning based on ID or Hostname
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Layout algorithms
function calculateLayout(
  nodes: Node[], 
  width: number, 
  height: number, 
  mode: "grid" | "circle" | "random" = "grid"
): NodeWithPosition[] {
  const positionedNodes: NodeWithPosition[] = [];
  
  if (nodes.length === 0) return [];
  
  const padding = 100;
  const safeWidth = width - padding * 2;
  const safeHeight = height - padding * 2;
  
  // Group by Subnet (mock based on first 3 octets of IP) if possible, 
  // but for now, let's just do a nice grid layout that centers itself.
  
  if (mode === "grid") {
    const columns = Math.ceil(Math.sqrt(nodes.length * (width / height)));
    const rows = Math.ceil(nodes.length / columns);
    
    const cellWidth = safeWidth / columns;
    const cellHeight = safeHeight / rows;
    
    nodes.forEach((node, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      
      // Add some random jitter so it looks more organic
      const jitterX = (Math.abs(hashString(node.id + "x")) % 30) - 15;
      const jitterY = (Math.abs(hashString(node.id + "y")) % 30) - 15;

      positionedNodes.push({
        ...node,
        x: padding + col * cellWidth + cellWidth / 2 + jitterX,
        y: padding + row * cellHeight + cellHeight / 2 + jitterY
      });
    });
  } 
  
  return positionedNodes;
}

export function NetworkMap({ nodes, onNodeSelect, selectedNodeId }: NetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };
    
    // Initial size
    handleResize();
    
    // Resize Observer for robust dimension tracking
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  const positionedNodes = useMemo(() => {
    return calculateLayout(nodes, dimensions.width, dimensions.height, "grid");
  }, [nodes, dimensions]);


  // Draw connections between nodes on same subnet?
  // For now, let's draw connections to a central "Hub" or "Router" representation if we had one.
  // Instead, let's just draw lines between nodes that might be "related" or just nearest neighbors for visual flair.
  // Or simply, no lines for this MVP, focusing on the nodes themselves being interactive interactable objects.
  
  return (
    <div 
      ref={containerRef} 
      className="w-full h-full bg-grid-slate-900/[0.04] bg-[size:40px_40px] relative overflow-hidden"
      style={{ minHeight: "600px" }}
    >
      {/* Background Decor */}
      <div className="absolute inset-0 bg-gradient-to-tr from-background via-background/90 to-background/50 pointer-events-none" />
      
      <AnimatePresence>
        {positionedNodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const isOnline = node.status === "Online";
          
          return (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ 
                opacity: 1, 
                scale: 1,
                x: node.x - 40, // Center based on width
                y: node.y - 40
              }}
              transition={{ 
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: (hashString(node.id) % 10) * 0.05 // Deterministic delay
              }}
              whileHover={{ scale: 1.1, zIndex: 10 }}
              className="absolute top-0 left-0 cursor-pointer"
              onClick={() => onNodeSelect(node.id)}
            >
                <Tooltip>
                  <TooltipTrigger className="cursor-default">
                    <div className={cn(
                      "w-20 h-20 rounded-2xl flex flex-col items-center justify-center border-2 transition-colors relative shadow-sm hover:shadow-md bg-card",
                      isSelected ? "border-primary shadow-[0_0_20px_rgba(var(--primary),0.3)]" : "border-border hover:border-primary/50",
                      // Status glow
                      isOnline ? "shadow-green-500/10" : ""
                    )}>
                      {/* Status Indicator */}
                      <span className={cn(
                        "absolute top-2 right-2 w-2.5 h-2.5 rounded-full",
                        node.status === "Online" ? "bg-green-500 animate-pulse" : 
                        node.status === "Offline" ? "bg-red-500" : "bg-yellow-500"
                      )} />
                      
                      {/* Icon based on OS or Default */}
                      <div className="text-muted-foreground mb-1">
                        {node.os?.toLowerCase().includes("win") ? <Laptop className="w-8 h-8" /> : 
                         node.os?.toLowerCase().includes("linux") ? <TerminalSquare className="w-8 h-8" /> : 
                         <Server className="w-8 h-8" />}
                      </div>
                      
                      {/* Label */}
                      <span className="text-[10px] font-mono font-medium max-w-[90%] truncate px-1">
                        {node.hostname}
                      </span>
                      
                      {/* Selection Ring Animation */}
                      {isSelected && (
                        <motion.div
                          layoutId="selectionRing"
                          className="absolute -inset-2 border-2 border-primary/30 rounded-3xl"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3 }}
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="font-bold">{node.hostname}</span>
                      <span>{node.ipAddress || "No IP"}</span>
                      <span>{node.os || "Unknown OS"}</span>
                      <span className={cn(
                        "font-mono",
                        node.status === "Online" ? "text-green-500" : "text-red-500"
                      )}>{node.status}</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Empty State */}
      {nodes.length === 0 && (
         <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            No nodes found to display on map.
         </div>
      )}
      
      {/* Legend / Info Overlay */}
      <div className="absolute bottom-4 left-4 p-3 bg-card/80 backdrop-blur border border-border rounded-lg shadow-sm text-xs space-y-2 pointer-events-none">
        <div className="font-medium mb-1">Network Map</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Online</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span>Offline</span>
        </div>
      </div>
    </div>
  );
}
