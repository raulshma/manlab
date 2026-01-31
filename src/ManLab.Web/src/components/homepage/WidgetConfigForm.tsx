import React, { useState } from "react";
import type { WidgetTypeDefinitionDto, WidgetConfigPropertyDto } from "@/types/dashboard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface WidgetConfigFormProps {
  widgetDefinition: WidgetTypeDefinitionDto;
  initialConfig: Record<string, any>;
  onSave: (config: Record<string, any>) => void;
  onCancel: () => void;
}

export function WidgetConfigForm({
  widgetDefinition,
  initialConfig,
  onSave,
  onCancel,
}: WidgetConfigFormProps) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const config = { ...(initialConfig || {}) };
    
    Object.entries(widgetDefinition.configSchema).forEach(([key, schema]) => {
      if (config[key] === undefined && schema.defaultValue !== undefined) {
        config[key] = schema.defaultValue;
      }
    });

    return config;
  });

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const renderField = (key: string, schema: WidgetConfigPropertyDto) => {
    const value = formData[key];

    switch (schema.type) {
      case "text":
      case "url":
        return (
          <Input
            id={key}
            type={schema.type}
            value={value || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            placeholder={schema.defaultValue as string}
          />
        );
      
      case "number":
        return (
          <Input
            id={key}
            type="number"
            value={value || ""}
            min={schema.min}
            max={schema.max}
            onChange={(e) => handleChange(key, Number(e.target.value))}
            placeholder={String(schema.defaultValue)}
          />
        );

      case "boolean":
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={key}
              checked={!!value}
              onCheckedChange={(checked) => handleChange(key, checked)}
            />
            <Label htmlFor={key} className="font-normal cursor-pointer">
              {schema.label}
            </Label>
          </div>
        );

      case "select":
      case "enum": // Fallback for enum
        return (
          <Select
            value={String(value || "")}
            onValueChange={(val) => handleChange(key, val)}
          >
            <SelectTrigger id={key}>
              <SelectValue placeholder="Select..." />
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
            value={value || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            rows={5}
            placeholder={schema.defaultValue as string}
          />
        );

      case "multiselect":
        return (
          <div className="flex flex-col gap-2 p-2 border rounded-md">
            {schema.options?.map((option) => {
              const isSelected = (value as string[])?.includes(option);
              return (
                <div key={option} className="flex items-center space-x-2">
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
                  <Label htmlFor={`${key}-${option}`} className="font-normal text-sm cursor-pointer capitalize">
                     {/* Try to make options readable if they are keys */}
                    {option.replace(/([A-Z])/g, " $1").trim()}
                  </Label>
                </div>
              );
            })}
          </div>
        );
      
      // TODO: Implement cleaner array editor for bookmark widget
      case "array":
         if(key === 'bookmarks') {
             return (
                 <div className="text-sm text-yellow-600 border border-yellow-200 bg-yellow-50 p-2 rounded">
                     Use JSON editor for complex arrays currently.
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
                        rows={10}
                        className="font-mono mt-1 text-xs"
                      />
                 </div>
             )
         }
         return <div className="text-sm text-muted-foreground">Array editing not fully supported yet</div>;

      default:
        return <div className="text-red-500 text-sm">Unsupported field type: {schema.type}</div>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {Object.entries(widgetDefinition.configSchema).map(([key, schema]) => (
          <div key={key} className="space-y-2">
            {schema.type !== "boolean" && (
              <Label htmlFor={key} className="font-medium">
                {schema.label}
                 {schema.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
            )}
            
            {renderField(key, schema)}
            
            {schema.description && (
              <p className="text-xs text-muted-foreground">{schema.description}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)}>
          Save Configuration
        </Button>
      </div>
    </div>
  );
}
