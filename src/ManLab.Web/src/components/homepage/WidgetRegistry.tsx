import type { LucideIcon } from "lucide-react";
import { 
  Server, 
  Activity, 
  BarChart3, 
  RefreshCw, 
  Rss, 
  Cloud, 
  Clock, 
  Bookmark, 
  Code, 
  Globe 
} from "lucide-react";
import type { WidgetTypeDefinitionDto } from "@/types/dashboard";

// Widget definitions
export const widgetTypes: WidgetTypeDefinitionDto[] = [
  {
    type: "node-card",
    name: "Node Card",
    description: "Display a node's status and resource usage",
    category: "fleet",
    icon: "Server",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a specific node or choose 'All Nodes' to show multiple",
        required: true,
        options: ["auto"],
        defaultValue: "auto"
      },
      compactMode: {
        type: "boolean",
        label: "Compact Mode",
        description: "Show mini cards instead of detailed cards",
        defaultValue: false
      }
    }
  },
  {
    type: "fleet-stats",
    name: "Fleet Statistics",
    description: "Show overall fleet health metrics",
    category: "fleet",
    icon: "Activity",
    requiresAdmin: false,
    configSchema: {
      stats: {
        type: "multiselect",
        label: "Statistics",
        description: "Which statistics to display",
        required: true,
        options: ["total", "online", "offline", "avgCpu", "avgRam", "avgDisk", "issues"],
        defaultValue: ["total", "online", "avgCpu", "issues"]
      },
      refreshInterval: {
        type: "number",
        label: "Refresh Interval (seconds)",
        description: "How often to refresh the statistics",
        required: true,
        min: 10,
        max: 300,
        defaultValue: 30
      }
    }
  },
  {
    type: "resource-chart",
    name: "Resource History Chart",
    description: "Display resource usage over time for a node",
    category: "fleet",
    icon: "BarChart3",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select which node to chart",
        required: true,
        options: ["auto"],
        defaultValue: "auto"
      },
      metrics: {
        type: "multiselect",
        label: "Metrics",
        description: "Which metrics to display",
        required: true,
        options: ["cpu", "ram", "disk", "temperature"],
        defaultValue: ["cpu", "ram"]
      },
      timeRange: {
        type: "select",
        label: "Time Range",
        required: true,
        options: ["1h", "6h", "12h", "24h", "48h"],
        defaultValue: "24h"
      },
      height: {
        type: "select",
        label: "Height",
        required: true,
        options: ["1", "2", "3", "4"],
        defaultValue: "2"
      }
    }
  },
  {
    type: "system-updates",
    name: "System Updates",
    description: "Show pending system updates across the fleet",
    category: "fleet",
    icon: "RefreshCw",
    requiresAdmin: false,
    configSchema: {
      showAllNodes: {
        type: "boolean",
        label: "Show All Nodes",
        description: "List all nodes with updates, or just show the count",
        defaultValue: false
      },
      criticalOnly: {
        type: "boolean",
        label: "Critical Only",
        description: "Show only critical updates",
        defaultValue: false
      }
    }
  },
  {
    type: "rss-feed",
    name: "RSS Feed",
    description: "Display items from an RSS or Atom feed",
    category: "feed",
    icon: "Rss",
    requiresAdmin: false,
    configSchema: {
      feedUrl: {
        type: "url",
        label: "Feed URL",
        description: "URL of the RSS or Atom feed",
        required: true,
        defaultValue: ""
      },
      maxItems: {
        type: "number",
        label: "Max Items",
        description: "Maximum number of feed items to display",
        required: true,
        min: 1,
        max: 50,
        defaultValue: 10
      },
      showThumbnails: {
        type: "boolean",
        label: "Show Thumbnails",
        defaultValue: true
      }
    }
  },
  {
    type: "weather",
    name: "Weather",
    description: "Display current weather information",
    category: "info",
    icon: "Cloud",
    requiresAdmin: false,
    configSchema: {
      location: {
        type: "text",
        label: "Location",
        description: "City name or coordinates (lat,lon)",
        required: true,
        defaultValue: ""
      },
      units: {
        type: "select",
        label: "Units",
        required: true,
        options: ["celsius", "fahrenheit"],
        defaultValue: "celsius"
      }
    }
  },
  {
    type: "time-date",
    name: "Time & Date",
    description: "Display current time and date",
    category: "info",
    icon: "Clock",
    requiresAdmin: false,
    configSchema: {
      showDate: {
        type: "boolean",
        label: "Show Date",
        defaultValue: true
      },
      timeFormat: {
        type: "select",
        label: "Time Format",
        required: true,
        options: ["12h", "24h"],
        defaultValue: "24h"
      },
      timeZone: {
        type: "text",
        label: "Time Zone",
        description: "Specific time zone or leave blank for local",
        defaultValue: ""
      }
    }
  },
  {
    type: "bookmark",
    name: "Quick Links",
    description: "Display a grid of bookmark links",
    category: "bookmark",
    icon: "Bookmark",
    requiresAdmin: false,
    configSchema: {
      bookmarks: {
        type: "array",
        label: "Bookmarks",
        description: "Array of bookmark objects with title, url, and icon",
        required: true,
        defaultValue: []
      },
      columns: {
        type: "select",
        label: "Columns",
        description: "Number of columns in the bookmark grid",
        required: true,
        min: 1,
        max: 6,
        defaultValue: 3
      }
    }
  },
  {
    type: "custom-html",
    name: "Custom HTML",
    description: "Render custom HTML content",
    category: "custom",
    icon: "Code",
    requiresAdmin: true,
    configSchema: {
      htmlContent: {
        type: "textarea",
        label: "HTML Content",
        description: "Raw HTML to render in the widget",
        required: true,
        defaultValue: ""
      }
    }
  },
  {
    type: "custom-iframe",
    name: "Custom Iframe",
    description: "Embed external content in an iframe",
    category: "custom",
    icon: "Globe",
    requiresAdmin: true,
    configSchema: {
      iframeUrl: {
        type: "url",
        label: "URL",
        description: "URL to embed in the iframe",
        required: true,
        defaultValue: ""
      },
      height: {
        type: "number",
        label: "Height (pixels)",
        required: true,
        min: 100,
        max: 2000,
        defaultValue: 400
      },
      allowFullscreen: {
        type: "boolean",
        label: "Allow Fullscreen",
        defaultValue: false
      }
    }
  }
];

export function getWidgetIcon(name: string): LucideIcon {
  const iconMap: Record<string, LucideIcon> = {
    Server,
    Activity,
    BarChart3,
    RefreshCw,
    Rss,
    Cloud,
    Clock,
    Bookmark,
    Code,
    Globe
  };
  
  return iconMap[name] || Activity;
}
