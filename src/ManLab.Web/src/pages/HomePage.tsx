import React, { useState, useCallback, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Responsive } from "react-grid-layout";
import { WidthProvider } from "@/components/homepage/WidthProvider";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fetchDashboardLayout, saveDashboardLayout, fetchWidgetTypes } from "@/api";
import type { DashboardWidgetDto, WidgetTypeDefinitionDto } from "@/types/dashboard";
import { Server, Plus, AlertCircle } from "lucide-react";
import { getWidgetIcon } from "@/components/homepage/WidgetRegistry";
import { FleetStatsWidget } from "@/components/homepage/widgets/FleetStatsWidget";
import { RssFeedWidget } from "@/components/homepage/widgets/RssFeedWidget";
import { BookmarkWidget } from "@/components/homepage/widgets/BookmarkWidget";
import { TimeDateWidget } from "@/components/homepage/widgets/TimeDateWidget";
import { WeatherWidget } from "@/components/homepage/widgets/WeatherWidget";
import { NodeCardWidget } from "@/components/homepage/widgets/NodeCardWidget";
import { ResourceChartWidget } from "@/components/homepage/widgets/ResourceChartWidget";
import { SystemUpdatesWidget } from "@/components/homepage/widgets/SystemUpdatesWidget";
import { CustomHtmlWidget } from "@/components/homepage/widgets/CustomHtmlWidget";
import { CustomIframeWidget } from "@/components/homepage/widgets/CustomIframeWidget";
import { NetworkTrafficWidget } from "@/components/homepage/widgets/NetworkTrafficWidget";
import { GpuMonitorWidget } from "@/components/homepage/widgets/GpuMonitorWidget";
import { TopProcessesWidget } from "@/components/homepage/widgets/TopProcessesWidget";
import { DiskHealthWidget } from "@/components/homepage/widgets/DiskHealthWidget";
import { ScriptRunsWidget } from "@/components/homepage/widgets/ScriptRunsWidget";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WidgetConfigForm } from "@/components/homepage/WidgetConfigForm";
import { Settings } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";

const ResponsiveGrid = WidthProvider(Responsive);

type WidgetCategory = "all" | "fleet" | "feed" | "info" | "bookmark" | "custom";

// React-Grid-Layout constants
const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const GRID_COLS = { lg: 4, md: 3, sm: 2, xs: 1, xxs: 1 };

export function HomePage() {
  const { data: dashboard, isLoading, refetch, error: loadError } = useQuery({
    queryKey: ["dashboardLayout"],
    queryFn: fetchDashboardLayout,
    // Use a stale time to prevent immediate refetching unless necessary
    staleTime: 5_000,
  });

  const { data: widgetTypes } = useQuery({
    queryKey: ["widgetTypes"],
    queryFn: fetchWidgetTypes,
    staleTime: 300_000,
  });

  const saveLayout = useMutation({
    mutationFn: saveDashboardLayout,
    onSuccess: () => {
      refetch();
    },
  });

  if (loadError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load dashboard configuration. Only cached data might be available.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // The DashboardGrid component is keyed by the dashboard ID/Update time.
  // This ensures that when the dashboard data changes from the source (server),
  // we re-initialize the local state (layouts) correctly without using useEffect to sync.
  return (
    <DashboardGrid
      key={dashboard?.updatedAt ?? "loading"}
      initialWidgets={dashboard?.widgets ?? []}
      dashboardName={dashboard?.name ?? "Default Dashboard"}
      dashboardId={dashboard?.id ?? ""}
      widgetTypes={widgetTypes ?? []}
      isLoading={isLoading}
      isSaving={saveLayout.isPending}
      onSave={async (layouts) => {
        await saveLayout.mutateAsync({
          id: dashboard?.id ?? "",
          name: dashboard?.name ?? "Default Dashboard",
          widgets: layouts,
          updatedAt: new Date().toISOString(),
        });
      }}
    />
  );
}

interface DashboardGridProps {
  initialWidgets: DashboardWidgetDto[];
  dashboardName: string;
  dashboardId: string;
  widgetTypes: WidgetTypeDefinitionDto[];
  isLoading: boolean;
  isSaving: boolean;
  onSave: (layouts: DashboardWidgetDto[]) => Promise<void>;
}

const DashboardGrid = memo(function DashboardGrid({
  initialWidgets,
  widgetTypes,
  isLoading,
  isSaving,
  onSave,
}: DashboardGridProps) {
  const [layouts, setLayouts] = useState<DashboardWidgetDto[]>(initialWidgets);
  const [editMode, setEditMode] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<WidgetCategory>("all");
  const [configuringWidget, setConfiguringWidget] = useState<DashboardWidgetDto | null>(null);
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm();

  const onLayoutChange = useCallback((currentLayout: Layout) => {
    setLayouts((prevLayouts) => {
      return prevLayouts.map((widget) => {
        const layoutItem = currentLayout.find((l) => l.i === widget.id);
        if (layoutItem) {
          return {
            ...widget,
            column: layoutItem.x,
            row: layoutItem.y,
            width: layoutItem.w,
            height: layoutItem.h,
          };
        }
        return widget;
      });
    });
  }, []);

  const handleSaveLayout = useCallback(async () => {
    await onSave(layouts);
    setEditMode(false);
  }, [layouts, onSave]);

  const getDefaultConfig = useCallback((widgetType: string): Record<string, unknown> => {
    const widgetConfig = widgetTypes?.find((wt) => wt.type === widgetType);
    if (widgetConfig?.configSchema) {
      const defaultConfig: Record<string, unknown> = {};
      Object.entries(widgetConfig.configSchema).forEach(([key, prop]) => {
        defaultConfig[key] = prop.defaultValue ?? null;
      });
      return defaultConfig;
    }
    return {};
  }, [widgetTypes]);

  const handleAddWidget = useCallback((widgetType: string) => {
    const id = `widget-${widgetType}-${crypto.randomUUID()}`;
    const newWidget: DashboardWidgetDto = {
      id,
      type: widgetType,
      column: 0,
      row: 0,
      width: 1,
      height: 2,
      config: getDefaultConfig(widgetType),
    };

    setLayouts((prev) => [...prev, newWidget]);
    setShowAddWidget(false);
    setEditMode(true);
  }, [getDefaultConfig]);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    setLayouts((prev) => prev.filter((w) => w.id !== widgetId));
  }, []);

  const handleConfigChange = useCallback((widgetId: string, newConfig: Record<string, unknown>) => {
    setLayouts((prevLayouts) => {
      const updatedLayouts = prevLayouts.map((widget) => {
        if (widget.id === widgetId) {
          return {
            ...widget,
            config: {
              ...widget.config,
              ...newConfig,
            },
          };
        }
        return widget;
      });
      
      onSave(updatedLayouts);
      return updatedLayouts;
    });
  }, [onSave]);

  const handleSaveConfig = useCallback((newConfig: Record<string, unknown>) => {
    if (configuringWidget) {
      handleConfigChange(configuringWidget.id, newConfig);
      setConfiguringWidget(null);
    }
  }, [configuringWidget, handleConfigChange]);

  const handleResetLayout = useCallback(async () => {
    const confirmed = await confirm({
      title: "Reset Dashboard",
      description: "Reset dashboard to default configuration?",
      confirmText: "Reset",
      cancelText: "Cancel",
      destructive: true,
    });
    if (confirmed) {
      setLayouts([]);
      onSave([]);
    }
  }, [onSave, confirm]);

  const getWidgetByType = useCallback((widgetType: string) => {
    return widgetTypes?.find((wt) => wt.type === widgetType);
  }, [widgetTypes]);

  const categoryWidgets = widgetTypes?.reduce((acc, wt) => {
    const category = wt.category || "fleet";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(wt);
    return acc;
  }, {} as Record<WidgetCategory, WidgetTypeDefinitionDto[]>);

  return (
    <div className="min-h-screen bg-background/50">
      <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-primary to-primary/60">
              Homepage
            </h1>
            <p className="text-muted-foreground text-lg font-light max-w-2xl">
              Customizable dashboard with fleet monitoring, RSS feeds, and more
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? "Done Editing" : "Edit Layout"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveLayout}
              disabled={isSaving}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetLayout}
              disabled={editMode}
            >
              Reset
            </Button>
            <Sheet open={showAddWidget} onOpenChange={setShowAddWidget}>
              <SheetTrigger
                render={
                  <Button variant="default" size="sm" disabled={editMode}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Widget
                  </Button>
                }
              />
              <SheetContent className="w-[450px] flex flex-col">
                <SheetHeader className="px-6 py-6 border-b">
                  <SheetTitle className="text-xl">Add Widget</SheetTitle>
                  <SheetDescription>
                    Select a widget type to add to your dashboard
                  </SheetDescription>
                </SheetHeader>
                <div className="p-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Category</label>
                    <Select
                      value={selectedCategory}
                      onValueChange={(val) =>
                        val && setSelectedCategory(val as WidgetCategory)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="fleet">Fleet Monitoring</SelectItem>
                        <SelectItem value="feed">Feeds</SelectItem>
                        <SelectItem value="info">Information</SelectItem>
                        <SelectItem value="bookmark">Bookmarks</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator className="opacity-50" />
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                  {selectedCategory === "all" ? (
                    Object.entries(categoryWidgets || {}).map(([category, widgets]) => (
                      <div key={category} className="space-y-3">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
                          {category}
                        </h3>
                        <div className="grid grid-cols-1 gap-3">
                          {widgets.map((wt) => {
                            const Icon = getWidgetIcon(wt.icon);
                            return (
                              <button
                                key={wt.type}
                                onClick={() => {
                                  setShowAddWidget(false);
                                  handleAddWidget(wt.type);
                                }}
                                className="group relative flex items-start gap-4 p-4 text-left bg-muted/20 hover:bg-muted/40 rounded-xl border border-border/50 hover:border-primary/40 transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                              >
                                <div className="shrink-0 p-2.5 bg-background rounded-lg border border-border/50 group-hover:border-primary/30 group-hover:text-primary transition-colors">
                                  <Icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 space-y-1">
                                  <div className="font-semibold text-sm leading-none">
                                    {wt.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
                                    {wt.description}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    (categoryWidgets?.[selectedCategory] || []).map((wt) => {
                      const Icon = getWidgetIcon(wt.icon);
                      return (
                        <button
                          key={wt.type}
                          onClick={() => {
                            setShowAddWidget(false);
                            handleAddWidget(wt.type);
                          }}
                          className="group relative flex items-start gap-4 p-4 text-left bg-muted/20 hover:bg-muted/40 rounded-xl border border-border/50 hover:border-primary/40 transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                        >
                          <div className="shrink-0 p-2.5 bg-background rounded-lg border border-border/50 group-hover:border-primary/30 group-hover:text-primary transition-colors">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="font-semibold text-sm leading-none">
                              {wt.name}
                            </div>
                            <div className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
                              {wt.description}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleResetLayout}
              disabled={editMode}
            >
              Reset
            </Button>
          </div>
        </header>

        <Separator className="bg-border/40" />

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Server className="h-8 w-8 text-muted-foreground animate-spin" />
            <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
          </div>
        )}

        {!isLoading && layouts.length === 0 && (
          <div className="text-center py-20">
            <Server className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-muted-foreground mb-2">
              Welcome to Your Homepage
            </h2>
            <p className="text-muted-foreground/80 max-w-md mx-auto">
              Add widgets to customize your dashboard. You can monitor your fleet,
              display RSS feeds, show weather, and add quick links.
            </p>
            <div className="mt-6">
              <Button onClick={() => handleAddWidget("fleet-stats")}>
                Add Fleet Stats Widget
              </Button>
            </div>
          </div>
        )}

        {!isLoading && layouts.length > 0 && (
          <ResponsiveGrid
            className="layout"
            breakpoints={GRID_BREAKPOINTS}
            cols={GRID_COLS}
            rowHeight={200}
            layouts={{
              lg: layouts.map((w) => ({
                i: w.id,
                x: w.column,
                y: w.row,
                w: w.width,
                h: w.height,
              })),
              md: layouts.map((w) => ({
                i: w.id,
                x: w.column,
                y: w.row,
                w: w.width,
                h: w.height,
              })),
              sm: layouts.map((w) => ({
                i: w.id,
                x: w.column,
                y: w.row,
                w: w.width,
                h: w.height,
              })),
              xs: layouts.map((w) => ({
                i: w.id,
                x: w.column,
                y: w.row,
                w: w.width,
                h: w.height,
              })),
              xxs: layouts.map((w) => ({
                i: w.id,
                x: w.column,
                y: w.row,
                w: w.width,
                h: w.height,
              })),
            }}
            onLayoutChange={onLayoutChange}
            draggableHandle=".drag-handle"
            isDraggable={editMode}
            isResizable={editMode}
            margin={[16, 16]}
          >
            {layouts.map((widget) => {
              const widgetDef = getWidgetByType(widget.type);
              return (
                <div
                  key={widget.id}
                  className="bg-card border shadow-sm hover:shadow-md transition-shadow rounded-lg"
                >
                  <Card className="border-0 shadow-none hover:shadow-none transition-shadow h-full">
                    <CardHeader className="flex items-start justify-between pb-3 drag-handle cursor-move">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">
                          {widgetDef?.name || widget.type}
                        </CardTitle>
                        <div className="text-xs text-muted-foreground/60 px-2 py-1 bg-muted/30 rounded">
                          {widget.type}
                        </div>
                      </div>
                      {editMode && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfiguringWidget(widget);
                            }}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveWidget(widget.id);
                            }}
                            className="h-8 w-8 text-destructive hover:text-destructive/90"
                          >
                            <span className="text-lg leading-none">×</span>
                          </Button>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="p-4 min-h-[180px]">
                      {renderWidgetContent(widget, (newConfig) => handleConfigChange(widget.id, newConfig))}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </ResponsiveGrid>
        )}
        
        <Dialog open={!!configuringWidget} onOpenChange={(open) => !open && setConfiguringWidget(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Configure Widget</DialogTitle>
              <DialogDescription>
                Customize settings for this widget.
              </DialogDescription>
            </DialogHeader>
            
            {configuringWidget && (
              <WidgetConfigForm
                key={configuringWidget.id}
                widgetDefinition={getWidgetByType(configuringWidget.type) as WidgetTypeDefinitionDto}
                initialConfig={configuringWidget.config}
                onSave={handleSaveConfig}
                onCancel={() => setConfiguringWidget(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => !open && handleCancel()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmState.title}</AlertDialogTitle>
              {confirmState.description && (
                <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel}>{confirmState.cancelText || "Cancel"}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                className={confirmState.destructive ? "bg-destructive hover:bg-destructive/90" : ""}
              >
                {confirmState.confirmText || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
});

function renderWidgetContent(
  widget: DashboardWidgetDto,
  onConfigChange: (config: Record<string, unknown>) => void
): React.ReactNode | null {
  switch (widget.type) {
    case "fleet-stats":
      return (
        <FleetStatsWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "rss-feed":
      return (
        <RssFeedWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "bookmark":
      return (
        <BookmarkWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "time-date":
      return (
        <TimeDateWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "weather":
      return (
        <WeatherWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "node-card":
      return (
        <NodeCardWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "resource-chart":
      return (
        <ResourceChartWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "system-updates":
      return (
        <SystemUpdatesWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "custom-html":
      return (
        <CustomHtmlWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "custom-iframe":
      return (
        <CustomIframeWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "network-traffic":
      return (
        <NetworkTrafficWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "gpu-monitor":
      return (
        <GpuMonitorWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "top-processes":
      return (
        <TopProcessesWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "disk-health":
      return (
        <DiskHealthWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "script-runs":
      return (
        <ScriptRunsWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    default:
      return <div>Unknown widget type: {widget.type}</div>;
  }
}
