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
  Globe,
  Network,
  Monitor,
  Terminal,
  HardDrive,
  ScrollText,
  Bell,
  Database,
  Power,
  Settings
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
  },
  {
    type: "network-traffic",
    name: "Network Traffic",
    description: "Display real-time network RX/TX statistics",
    category: "fleet",
    icon: "Network",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node to monitor",
        required: true,
        options: ["auto"],
        defaultValue: ""
      },
      showHistory: {
        type: "boolean",
        label: "Show History Chart",
        description: "Display a mini chart of recent traffic",
        defaultValue: true
      }
    }
  },
  {
    type: "gpu-monitor",
    name: "GPU Monitor",
    description: "Display GPU utilization, temperature, and memory usage",
    category: "fleet",
    icon: "Monitor",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node with NVIDIA GPUs",
        required: true,
        options: ["auto"],
        defaultValue: ""
      },
      showAllGpus: {
        type: "boolean",
        label: "Show All GPUs",
        description: "Display all GPUs or just the first one",
        defaultValue: true
      }
    }
  },
  {
    type: "top-processes",
    name: "Top Processes",
    description: "Display top CPU or memory consuming processes",
    category: "fleet",
    icon: "Terminal",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node to monitor",
        required: true,
        options: ["auto"],
        defaultValue: ""
      },
      maxProcesses: {
        type: "number",
        label: "Max Processes",
        description: "Number of processes to display",
        required: true,
        min: 3,
        max: 20,
        defaultValue: 5
      },
      sortBy: {
        type: "select",
        label: "Sort By",
        description: "Sort processes by CPU or memory usage",
        required: true,
        options: ["cpu", "memory"],
        defaultValue: "cpu"
      }
    }
  },
  {
    type: "disk-health",
    name: "Disk Health",
    description: "Display SMART disk health status and statistics",
    category: "fleet",
    icon: "HardDrive",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node to monitor",
        required: true,
        options: ["auto"],
        defaultValue: ""
      },
      showAllDrives: {
        type: "boolean",
        label: "Show All Drives",
        description: "Display all drives or just the first one",
        defaultValue: true
      }
    }
  },
  {
    type: "script-runs",
    name: "Recent Scripts",
    description: "Display recent script execution history",
    category: "fleet",
    icon: "ScrollText",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node to view script runs",
        required: true,
        options: ["auto"],
        defaultValue: ""
      },
      maxRuns: {
        type: "number",
        label: "Max Runs",
        description: "Number of recent runs to display",
        required: true,
        min: 3,
        max: 20,
        defaultValue: 5
      }
    }
  },
  {
    type: "alerts",
    name: "Fleet Alerts",
    description: "Display recent alerts and warnings from your fleet",
    category: "fleet",
    icon: "Bell",
    requiresAdmin: false,
    configSchema: {
      maxAlerts: {
        type: "number",
        label: "Max Alerts",
        description: "Maximum number of alerts to display",
        required: true,
        min: 3,
        max: 50,
        defaultValue: 10
      },
      severityFilter: {
        type: "multiselect",
        label: "Severity Filter",
        description: "Which alert severities to show",
        required: true,
        options: ["critical", "warning", "info"],
        defaultValue: ["critical", "warning"]
      }
    }
  },
  {
    type: "disk-usage",
    name: "Disk Usage",
    description: "Monitor storage utilization across your fleet",
    category: "fleet",
    icon: "Database",
    requiresAdmin: false,
    configSchema: {
      showAllNodes: {
        type: "boolean",
        label: "Show All Nodes",
        description: "Show all nodes or only those with warnings",
        defaultValue: true
      },
      warningThreshold: {
        type: "number",
        label: "Warning Threshold (%)",
        description: "Disk usage percentage to trigger warning",
        required: true,
        min: 50,
        max: 95,
        defaultValue: 80
      },
      criticalThreshold: {
        type: "number",
        label: "Critical Threshold (%)",
        description: "Disk usage percentage to trigger critical alert",
        required: true,
        min: 70,
        max: 99,
        defaultValue: 90
      }
    }
  },
  {
    type: "uptime",
    name: "Uptime Monitor",
    description: "Track system uptime across your fleet",
    category: "fleet",
    icon: "Power",
    requiresAdmin: false,
    configSchema: {
      showAllNodes: {
        type: "boolean",
        label: "Show All Nodes",
        description: "Show all nodes or only offline/problem nodes",
        defaultValue: true
      },
      maxNodes: {
        type: "number",
        label: "Max Nodes",
        description: "Maximum number of nodes to display",
        required: true,
        min: 3,
        max: 30,
        defaultValue: 10
      },
      sortBy: {
        type: "select",
        label: "Sort By",
        description: "How to sort the nodes list",
        required: true,
        options: ["uptime", "name", "status"],
        defaultValue: "uptime"
      }
    }
  },
  {
    type: "service-status",
    name: "Service Status",
    description: "Monitor critical service health across your fleet",
    category: "fleet",
    icon: "Settings",
    requiresAdmin: false,
    configSchema: {
      nodeId: {
        type: "select",
        label: "Node",
        description: "Select a node or choose 'All Nodes'",
        required: true,
        options: ["auto"],
        defaultValue: "auto"
      },
      showAllServices: {
        type: "boolean",
        label: "Show All Services",
        description: "Show all services or only non-running ones",
        defaultValue: false
      },
      maxServices: {
        type: "number",
        label: "Max Services",
        description: "Maximum services to show per node",
        required: true,
        min: 3,
        max: 20,
        defaultValue: 5
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
    Globe,
    Network,
    Monitor,
    Terminal,
    HardDrive,
    ScrollText,
    Bell,
    Database,
    Power,
    Settings
  };
  
  return iconMap[name] || Activity;
}
