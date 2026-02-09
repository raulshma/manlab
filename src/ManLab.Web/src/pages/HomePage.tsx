import React, { useState, useCallback, memo } from "react";
import { generateId } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Responsive } from "react-grid-layout";
import { WidthProvider } from "@/components/homepage/WidthProvider";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
import { AlertsWidget } from "@/components/homepage/widgets/AlertsWidget";
import { DiskUsageWidget } from "@/components/homepage/widgets/DiskUsageWidget";
import { UptimeWidget } from "@/components/homepage/widgets/UptimeWidget";
import { ServiceStatusWidget } from "@/components/homepage/widgets/ServiceStatusWidget";
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
    const id = `widget-${widgetType}-${generateId()}`;
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

  const handleSaveConfig = useCallback((
    newConfig: Record<string, unknown>, 
    newWidth?: number, 
    newHeight?: number, 
    newWidthPercent?: number, 
    newHeightPercent?: number,
    newHorizontalAlign?: 'left' | 'center' | 'right',
    newVerticalAlign?: 'top' | 'center' | 'bottom'
  ) => {
    if (configuringWidget) {
      // Update config
      handleConfigChange(configuringWidget.id, newConfig);

      // Update size and alignment if changed
      if (
        newWidth !== undefined || 
        newHeight !== undefined || 
        newWidthPercent !== undefined || 
        newHeightPercent !== undefined ||
        newHorizontalAlign !== undefined ||
        newVerticalAlign !== undefined
      ) {
        setLayouts((prevLayouts) => {
          const updatedLayouts = prevLayouts.map((widget) => {
            if (widget.id === configuringWidget.id) {
              return {
                ...widget,
                width: newWidth ?? widget.width,
                height: newHeight ?? widget.height,
                widthPercent: newWidthPercent,
                heightPercent: newHeightPercent,
                horizontalAlign: newHorizontalAlign ?? widget.horizontalAlign,
                verticalAlign: newVerticalAlign ?? widget.verticalAlign,
              };
            }
            return widget;
          });

          onSave(updatedLayouts);
          return updatedLayouts;
        });
      }

      setConfiguringWidget(null);
    }
  }, [configuringWidget, handleConfigChange, onSave]);

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
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1600px] space-y-10 p-6 md:p-10 lg:p-12">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/40">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground">
              Overview
            </h1>
            <p className="text-muted-foreground text-lg font-medium max-w-2xl leading-relaxed">
              Your command center for fleet operations, intelligence, and system status.
            </p>
          </div>
          <div className="flex items-center gap-3">
             <Button
              variant={editMode ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setEditMode(!editMode)}
              className="font-medium"
            >
              {editMode ? "Done Editing" : "Edit Layout"}
            </Button>
            
            {editMode && (
              <>
                 <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveLayout}
                  disabled={isSaving}
                   className="animate-in fade-in zoom-in-95 duration-200"
                >
                  Save Changes
                </Button>
                 <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleResetLayout}
                   className="animate-in fade-in zoom-in-95 duration-200"
                >
                  Reset
                </Button>
                 <Sheet open={showAddWidget} onOpenChange={setShowAddWidget}>
                  <SheetTrigger render={
                     <Button variant="default" size="sm" className="shadow-lg shadow-primary/20">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Widget
                      </Button>
                  } />
                  <SheetContent className="w-[500px] sm:w-[600px] flex flex-col p-0 gap-0 border-l border-border/50 shadow-2xl">
                    <SheetHeader className="px-8 py-6 border-b border-border/50 bg-muted/5">
                      <SheetTitle className="text-2xl font-bold tracking-tight">Add Widget</SheetTitle>
                      <SheetDescription className="text-base">
                        Select a component to enhance your dashboard capabilities.
                      </SheetDescription>
                    </SheetHeader>
                    
                    <div className="px-8 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
                         <div className="flex items-center gap-4">
                            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Filter by</span>
                            <Select
                              value={selectedCategory}
                              onValueChange={(val) =>
                                val && setSelectedCategory(val as WidgetCategory)
                              }
                            >
                              <SelectTrigger className="w-[180px] bg-background border-border/60">
                                <SelectValue placeholder="All Categories" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="fleet">Fleet Monitoring</SelectItem>
                                <SelectItem value="feed">Data Feeds</SelectItem>
                                <SelectItem value="info">Information</SelectItem>
                                <SelectItem value="bookmark">Quick Links</SelectItem>
                                <SelectItem value="custom">Custom Code</SelectItem>
                              </SelectContent>
                            </Select>
                         </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">
                       {selectedCategory === "all" ? (
                        Object.entries(categoryWidgets || {}).map(([category, widgets]) => (
                          <div key={category} className="space-y-4">
                            <div className="flex items-center gap-3">
                                <span className="h-px flex-1 bg-border/50"></span>
                                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                  {category === 'fleet' ? 'Fleet Monitoring' : category === 'feed' ? 'Data Feeds' : category}
                                </h3>
                                 <span className="h-px flex-1 bg-border/50"></span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {widgets.map((wt) => {
                                const Icon = getWidgetIcon(wt.icon);
                                return (
                                  <button
                                    key={wt.type}
                                    onClick={() => {
                                      setShowAddWidget(false);
                                      handleAddWidget(wt.type);
                                    }}
                                    className="group relative flex flex-col items-start gap-3 p-4 text-left bg-card hover:bg-accent/50 rounded-xl border border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
                                  >
                                    <div className="p-2.5 bg-muted/50 rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                      <Icon className="h-6 w-6" />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="font-bold text-sm">
                                        {wt.name}
                                      </div>
                                      <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           {(categoryWidgets?.[selectedCategory] || []).map((wt) => {
                            const Icon = getWidgetIcon(wt.icon);
                            return (
                              <button
                                key={wt.type}
                                onClick={() => {
                                  setShowAddWidget(false);
                                  handleAddWidget(wt.type);
                                }}
                                className="group relative flex flex-col items-start gap-3 p-4 text-left bg-card hover:bg-accent/50 rounded-xl border border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
                              >
                                <div className="p-2.5 bg-muted/50 rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                  <Icon className="h-6 w-6" />
                                </div>
                                <div className="space-y-1.5">
                                  <div className="font-bold text-sm">
                                    {wt.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                    {wt.description}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </>
            )}
            
            {!editMode && (
                 <Sheet open={showAddWidget} onOpenChange={setShowAddWidget}>
                  <SheetTrigger render={
                     <Button variant="outline" size="sm" className="ml-2 group">
                        <Plus className="h-4 w-4 mr-2 group-hover:text-primary transition-colors" />
                        Add Widget
                      </Button>
                  } />
                   {/* Render the same content, just duplicated trigger for non-edit mode convenience */}
                   <SheetContent className="w-[500px] sm:w-[600px] flex flex-col p-0 gap-0 border-l border-border/50 shadow-2xl">
                     <SheetHeader className="px-8 py-6 border-b border-border/50 bg-muted/5">
                      <SheetTitle className="text-2xl font-bold tracking-tight">Add Widget</SheetTitle>
                      <SheetDescription className="text-base">
                        Select a component to enhance your dashboard capabilities.
                      </SheetDescription>
                    </SheetHeader>
                    
                    <div className="px-8 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
                         <div className="flex items-center gap-4">
                            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Filter by</span>
                            <Select
                              value={selectedCategory}
                              onValueChange={(val) =>
                                val && setSelectedCategory(val as WidgetCategory)
                              }
                            >
                              <SelectTrigger className="w-[180px] bg-background border-border/60">
                                <SelectValue placeholder="All Categories" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="fleet">Fleet Monitoring</SelectItem>
                                <SelectItem value="feed">Data Feeds</SelectItem>
                                <SelectItem value="info">Information</SelectItem>
                                <SelectItem value="bookmark">Quick Links</SelectItem>
                                <SelectItem value="custom">Custom Code</SelectItem>
                              </SelectContent>
                            </Select>
                         </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">
                       {selectedCategory === "all" ? (
                        Object.entries(categoryWidgets || {}).map(([category, widgets]) => (
                          <div key={category} className="space-y-4">
                            <div className="flex items-center gap-3">
                                <span className="h-px flex-1 bg-border/50"></span>
                                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                  {category === 'fleet' ? 'Fleet Monitoring' : category === 'feed' ? 'Data Feeds' : category}
                                </h3>
                                 <span className="h-px flex-1 bg-border/50"></span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {widgets.map((wt) => {
                                const Icon = getWidgetIcon(wt.icon);
                                return (
                                  <button
                                    key={wt.type}
                                    onClick={() => {
                                      setShowAddWidget(false);
                                      handleAddWidget(wt.type);
                                    }}
                                    className="group relative flex flex-col items-start gap-3 p-4 text-left bg-card hover:bg-accent/50 rounded-xl border border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
                                  >
                                    <div className="p-2.5 bg-muted/50 rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                      <Icon className="h-6 w-6" />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="font-bold text-sm">
                                        {wt.name}
                                      </div>
                                      <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           {(categoryWidgets?.[selectedCategory] || []).map((wt) => {
                            const Icon = getWidgetIcon(wt.icon);
                            return (
                              <button
                                key={wt.type}
                                onClick={() => {
                                  setShowAddWidget(false);
                                  handleAddWidget(wt.type);
                                }}
                                className="group relative flex flex-col items-start gap-3 p-4 text-left bg-card hover:bg-accent/50 rounded-xl border border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
                              >
                                <div className="p-2.5 bg-muted/50 rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                  <Icon className="h-6 w-6" />
                                </div>
                                <div className="space-y-1.5">
                                  <div className="font-bold text-sm">
                                    {wt.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                    {wt.description}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </SheetContent>
               </Sheet>
            )}
          </div>
        </header>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-6 animate-pulse">
            <div className="p-4 bg-muted/50 rounded-full">
              <Server className="h-10 w-10 text-primary/50" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-medium tracking-tight">Initializing Dashboard</h3>
              <p className="text-muted-foreground">Loading your personalized layout...</p>
            </div>
          </div>
        )}

        {!isLoading && layouts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="p-8 bg-muted/20 rounded-full ring-1 ring-border shadow-xl">
              <Server className="h-20 w-20 text-muted-foreground/30" />
            </div>
            <div className="text-center space-y-4 max-w-lg">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                Your Dashboard is Empty
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Connect your fleet, add data feeds, or customize your workspace with widgets.
                It's a blank canvas waiting for your command.
              </p>
            </div>
            <div className="pt-2">
              <Button size="lg" onClick={() => handleAddWidget("fleet-stats")} className="text-base px-8 h-12 shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all">
                <Plus className="mr-2 h-5 w-5" />
                Initialize First Widget
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
            margin={[24, 24]}
          >
            {layouts.map((widget) => {
              const widgetDef = getWidgetByType(widget.type);
              return (
                <div
                  key={widget.id}
                  className="h-full flex"
                  style={{
                    justifyContent: widget.horizontalAlign === 'left' ? 'flex-start' : widget.horizontalAlign === 'right' ? 'flex-end' : 'center',
                    alignItems: widget.verticalAlign === 'top' ? 'flex-start' : widget.verticalAlign === 'bottom' ? 'flex-end' : 'center',
                  }}
                >
                  <Card 
                    className={`
                      group flex flex-col overflow-hidden transition-all duration-300
                      ${editMode ? 'ring-2 ring-primary/20 bg-background/80 hover:ring-primary/50' : 'bg-card border border-border/50 shadow-sm hover:shadow-md'}
                    `}
                    style={{
                      width: widget.widthPercent ? `${widget.widthPercent}%` : '100%',
                      height: widget.heightPercent ? `${widget.heightPercent}%` : '100%',
                    }}
                  >
                    {editMode && (
                      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 shrink-0 transition-colors bg-muted/10 cursor-move drag-handle border-b border-border/20">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div className="p-1 rounded bg-background border shadow-xs">
                             <div className="h-3 w-3 rounded-full bg-primary/40" />
                          </div>
                          <CardTitle className="text-sm font-semibold tracking-tight truncate">
                            {widgetDef?.name || widget.type}
                          </CardTitle>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfiguringWidget(widget);
                            }}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-background/80"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveWidget(widget.id);
                            }}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <span className="text-base leading-none">×</span>
                          </Button>
                        </div>
                      </CardHeader>
                    )}
                    <CardContent className="flex-1 overflow-y-auto overflow-x-hidden relative p-4">
                       {/* Overlay to prevent interaction during edit mode */}
                       {editMode && <div className="absolute inset-0 z-10 bg-background/40" />}
                       <div className="w-full h-full">
                         {renderWidgetContent(widget, (newConfig) => handleConfigChange(widget.id, newConfig))}
                       </div>
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
                initialWidth={configuringWidget.width}
                initialHeight={configuringWidget.height}
                initialWidthPercent={configuringWidget.widthPercent}
                initialHeightPercent={configuringWidget.heightPercent}
                initialHorizontalAlign={configuringWidget.horizontalAlign}
                initialVerticalAlign={configuringWidget.verticalAlign}
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
    case "alerts":
      return (
        <AlertsWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "disk-usage":
      return (
        <DiskUsageWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "uptime":
      return (
        <UptimeWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    case "service-status":
      return (
        <ServiceStatusWidget
          id={widget.id}
          config={widget.config}
          onConfigChange={onConfigChange}
        />
      );
    default:
      return <div>Unknown widget type: {widget.type}</div>;
  }
}
