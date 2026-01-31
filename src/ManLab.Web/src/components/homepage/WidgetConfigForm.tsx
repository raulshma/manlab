import { useState } from "react";
import type { WidgetTypeDefinitionDto, WidgetConfigPropertyDto } from "@/types/dashboard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

interface WidgetConfigFormProps {
  widgetDefinition: WidgetTypeDefinitionDto;
  initialConfig: Record<string, unknown>;
  initialWidth?: number;
  initialHeight?: number;
  onSave: (config: Record<string, unknown>, width?: number, height?: number) => void;
  onCancel: () => void;
}

export function WidgetConfigForm({
  widgetDefinition,
  initialConfig,
  initialWidth = 1,
  initialHeight = 2,
  onSave,
  onCancel,
}: WidgetConfigFormProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const config: Record<string, unknown> = { ...(initialConfig || {}) };

    Object.entries(widgetDefinition.configSchema).forEach(([key, schema]) => {
      if (config[key] === undefined && schema.defaultValue !== undefined) {
        config[key] = schema.defaultValue;
      }
    });

    return config;
  });

  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);

  const handleChange = (key: string, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const renderField = (key: string, schema: WidgetConfigPropertyDto) => {
    const value = formData[key] as string | number | boolean | string[] | undefined;

    switch (schema.type) {
      case "text":
      case "url":
        return (
          <Input
            id={key}
            type={schema.type}
            value={typeof value === "boolean" ? "" : (value as string | number | readonly string[] | undefined) || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            placeholder={String(schema.defaultValue || "")}
            className="bg-background/50"
          />
        );
      
      case "number":
        return (
          <Input
            id={key}
            type="number"
            value={typeof value === "boolean" ? "" : (value as string | number | readonly string[] | undefined) || ""}
            min={schema.min}
            max={schema.max}
            onChange={(e) => handleChange(key, Number(e.target.value))}
            placeholder={String(schema.defaultValue)}
            className="bg-background/50 font-mono"
          />
        );

      case "boolean":
        return (
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card/50">
            <div className="space-y-0.5">
               <Label htmlFor={key} className="text-base font-medium cursor-pointer">
                {schema.label}
              </Label>
               {schema.description && (
                <p className="text-xs text-muted-foreground">{schema.description}</p>
              )}
            </div>
            <Switch
              id={key}
              checked={!!value}
              onCheckedChange={(checked) => handleChange(key, checked)}
            />
          </div>
        );

      case "select":
      case "enum":
        return (
          <Select
            value={String(value || "")}
            onValueChange={(val) => handleChange(key, val)}
          >
            <SelectTrigger id={key} className="bg-background/50">
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              {schema.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "textarea":
        return (
          <Textarea
            id={key}
            value={typeof value === "boolean" ? "" : (value as string | number | readonly string[] | undefined) || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            rows={5}
            placeholder={String(schema.defaultValue || "")}
            className="bg-background/50 font-mono text-sm leading-relaxed"
          />
        );

      case "multiselect":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 border rounded-lg bg-card/30">
            {schema.options?.map((option) => {
              const isSelected = (value as string[])?.includes(option);
              return (
                <div 
                    key={option} 
                    className={`
                        flex items-center space-x-2 p-2 rounded-md transition-colors
                        ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'}
                    `}
                >
                  <Checkbox
                    id={`${key}-${option}`}
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const current = (value as string[]) || [];
                      if (checked) {
                        handleChange(key, [...current, option]);
                      } else {
                        handleChange(key, current.filter((v) => v !== option));
                      }
                    }}
                  />
                  <Label htmlFor={`${key}-${option}`} className="font-medium text-sm cursor-pointer capitalize flex-1">
                    {option.replace(/([A-Z])/g, " $1").trim()}
                  </Label>
                </div>
              );
            })}
          </div>
        );
      
      case "array":
         if(key === 'bookmarks') {
             return (
                 <div className="space-y-2">
                     <div className="text-xs text-amber-600/90 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 p-3 rounded-lg flex gap-2">
                         <Info className="h-4 w-4 shrink-0 mt-0.5" />
                         <p>Edit bookmarks as JSON array. Each object should have <code>title</code> and <code>url</code> properties.</p>
                     </div>
                     <Textarea
                        id={key}
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => {
                            try {
                                handleChange(key, JSON.parse(e.target.value));
                            } catch {
                                // invalid json ignore
                            }
                        }}
                        rows={12}
                        className="font-mono text-xs bg-muted/30"
                      />
                 </div>
             )
         }
         return <div className="text-sm text-muted-foreground p-2 border border-dashed rounded">Array editing not fully supported yet</div>;

      default:
        return <div className="text-destructive text-sm p-2 border border-destructive/20 bg-destructive/5 rounded">Unsupported field type: {schema.type}</div>;
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      <div className="flex-1 overflow-y-auto pr-2 space-y-8 py-2">
        
        {/* Dimensions Section */}
        <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground/90 uppercase tracking-widest border-b pb-2">Layout Dimensions</h3>
            <div className="grid grid-cols-2 gap-6 bg-muted/20 p-5 rounded-xl border border-border/40">
                <div className="space-y-2">
                    <Label htmlFor="widget-width" className="text-xs font-medium text-muted-foreground">Width (Columns)</Label>
                    <div className="relative">
                        <Input
                            id="widget-width"
                            type="number"
                            min={1}
                            max={4}
                            value={width}
                            onChange={(e) => setWidth(Number(e.target.value))}
                            className="bg-background border-border/60 pl-3 pr-8"
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-muted-foreground pointer-events-none">cols</span>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="widget-height" className="text-xs font-medium text-muted-foreground">Height (Rows)</Label>
                    <div className="relative">
                        <Input
                            id="widget-height"
                            type="number"
                            min={1}
                            max={10}
                            value={height}
                            onChange={(e) => setHeight(Number(e.target.value))}
                            className="bg-background border-border/60 pl-3 pr-8"
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-muted-foreground pointer-events-none">rows</span>
                    </div>
                </div>
                <div className="col-span-2 text-[10px] text-muted-foreground/60 text-center">
                    1 column ≈ 25% width • 1 row ≈ 200px height
                </div>
            </div>
        </section>

        {/* Configuration Section */}
        <section className="space-y-5">
            <h3 className="text-sm font-semibold text-foreground/90 uppercase tracking-widest border-b pb-2">Widget Settings</h3>
            
            {Object.keys(widgetDefinition.configSchema).length === 0 && (
                <div className="p-8 text-center text-muted-foreground bg-muted/10 rounded-xl border border-dashed">
                    No configuration options available for this widget.
                </div>
            )}

            {Object.entries(widgetDefinition.configSchema).map(([key, schema]) => (
            <div key={key} className="group space-y-2">
                {schema.type !== "boolean" && (
                <Label htmlFor={key} className="flex items-center gap-1.5 font-medium text-sm text-foreground/80">
                    {schema.label}
                    {schema.required && <span className="text-destructive text-[10px] align-top">*</span>}
                </Label>
                )}

                {renderField(key, schema)}

                {schema.description && schema.type !== "boolean" && (
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed max-w-[90%] pl-1">
                    {schema.description}
                </p>
                )}
            </div>
            ))}
        </section>
      </div>

      <div className="flex justify-end gap-3 pt-6 mt-2 border-t bg-background z-10">
        <Button variant="outline" onClick={onCancel} className="h-10 px-6">
          Cancel
        </Button>
        <Button onClick={() => onSave(formData, width, height)} className="h-10 px-6 shadow-md shadow-primary/10">
          Save Changes
        </Button>
      </div>
    </div>
  );
}
