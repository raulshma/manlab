export interface DashboardLayoutDto {
  id: string;
  name: string;
  widgets: DashboardWidgetDto[];
  updatedAt: string;
}

export interface DashboardWidgetDto {
  id: string;
  type: string;
  column: number;
  row: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

export interface RssFeedResponse {
  feedTitle: string;
  feedUrl: string;
  items: RssFeedItemDto[];
  cachedAt?: string;
}

export interface RssFeedItemDto {
  title: string;
  link: string;
  description?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  author?: string;
}

export interface RssFeedValidationResponse {
  valid: boolean;
  feedTitle?: string;
  error?: string;
}

export interface WidgetTypeDefinitionDto {
  type: string;
  name: string;
  description: string;
  category: "fleet" | "feed" | "info" | "bookmark" | "custom";
  icon: string;
  requiresAdmin: boolean;
  configSchema: Record<string, WidgetConfigPropertyDto>;
}

export interface WidgetConfigPropertyDto {
  type: string;
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  min?: number;
  max?: number;
}

export interface WidgetProps {
  id: string;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onRemove?: () => void;
}

export interface PendingUpdatesSummary {
  totalCount: number;
  nodeUpdates: NodeUpdate[];
  systemUpdates: SystemUpdate[];
}

export interface NodeUpdate {
  id: string;
  hostname: string;
  os: string;
  updatesCount: number;
  priority: string;
  updateType: string;
}

export interface SystemUpdate {
  id: string;
  priority: string;
  updateType: string;
  updatesCount: number;
}
