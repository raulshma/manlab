/**
 * Edit form components for monitoring jobs.
 * Each form provides inline editing for a specific job type.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CronExpressionEditor } from "./CronExpressionEditor";
import type {
  HttpMonitorConfig,
  TrafficMonitorConfig,
  ScheduledNetworkToolConfig,
  SystemUpdateSettings,
  AutoUpdateSettings,
} from "@/types";

// HTTP Monitor Edit Form
export function HttpMonitorEditForm({
  config,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  config: HttpMonitorConfig;
  onChange: (config: HttpMonitorConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={config.name}
            onChange={(e) => onChange({ ...config, name: e.target.value })}
            disabled={isSaving}
          />
        </div>

        {/* URL */}
        <div className="space-y-2">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            type="url"
            value={config.url}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            disabled={isSaving}
          />
        </div>

        {/* Method */}
        <div className="space-y-2">
          <Label htmlFor="method">Method</Label>
          <Select
            value={config.method ?? "GET"}
            onValueChange={(value) => onChange({ ...config, method: value })}
          >
            <SelectTrigger id="method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
              <SelectItem value="HEAD">HEAD</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Expected Status */}
        <div className="space-y-2">
          <Label htmlFor="expectedStatus">Expected Status</Label>
          <Input
            id="expectedStatus"
            type="number"
            value={config.expectedStatus ?? 200}
            onChange={(e) => onChange({ ...config, expectedStatus: parseInt(e.target.value) || 200 })}
            disabled={isSaving}
          />
        </div>

        {/* Body Contains */}
        <div className="space-y-2">
          <Label htmlFor="bodyContains">Body Contains (optional)</Label>
          <Input
            id="bodyContains"
            value={config.bodyContains ?? ""}
            onChange={(e) => onChange({ ...config, bodyContains: e.target.value || null })}
            disabled={isSaving}
            placeholder="Text to match in response body"
          />
        </div>

        {/* Timeout */}
        <div className="space-y-2">
          <Label htmlFor="timeout">Timeout (ms)</Label>
          <Input
            id="timeout"
            type="number"
            value={config.timeoutMs}
            onChange={(e) => onChange({ ...config, timeoutMs: parseInt(e.target.value) || 5000 })}
            disabled={isSaving}
          />
        </div>
      </div>

      {/* Schedule Section */}
      <div className="space-y-2 pt-4 border-t">
        <Label>Schedule</Label>
        <CronExpressionEditor
          value={config.cron || "0 */5 * * * ?"}
          onChange={(newCron) => onChange({ ...config, cron: newCron })}
          disabled={isSaving}
        />
      </div>

      {/* Enabled Toggle */}
      <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
        <Switch
          id="enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          disabled={isSaving}
        />
        <div className="flex-1">
          <Label htmlFor="enabled" className="cursor-pointer">
            {config.enabled ? "Enabled" : "Disabled"}
          </Label>
          <p className="text-xs text-muted-foreground">
            {config.enabled 
              ? "Monitor will run according to schedule" 
              : "Monitor is paused"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Traffic Monitor Edit Form
export function TrafficMonitorEditForm({
  config,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  config: TrafficMonitorConfig;
  onChange: (config: TrafficMonitorConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Interface Name */}
        <div className="space-y-2">
          <Label htmlFor="interfaceName">Interface Name</Label>
          <Input
            id="interfaceName"
            value={config.interfaceName ?? ""}
            onChange={(e) => onChange({ ...config, interfaceName: e.target.value || null })}
            disabled={isSaving}
            placeholder="eth0"
          />
        </div>

      </div>

      {/* Schedule Section */}
      <div className="space-y-2 pt-4 border-t">
        <Label>Schedule</Label>
        <CronExpressionEditor
          value={config.cron}
          onChange={(newCron) => onChange({ ...config, cron: newCron })}
          disabled={isSaving}
        />
      </div>

      {/* Enabled Toggle */}
      <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
        <Switch
          id="enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          disabled={isSaving}
        />
        <div className="flex-1">
          <Label htmlFor="enabled" className="cursor-pointer">
            {config.enabled ? "Enabled" : "Disabled"}
          </Label>
          <p className="text-xs text-muted-foreground">
            {config.enabled 
              ? "Monitor will run according to schedule" 
              : "Monitor is paused"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Network Tool Edit Form
export function NetworkToolEditForm({
  config,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  config: ScheduledNetworkToolConfig;
  onChange: (config: ScheduledNetworkToolConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={config.name}
            onChange={(e) => onChange({ ...config, name: e.target.value })}
            disabled={isSaving}
          />
        </div>

        {/* Tool Type */}
        <div className="space-y-2">
          <Label htmlFor="toolType">Tool Type</Label>
          <Select
            value={config.toolType}
            onValueChange={(value) => value && onChange({ ...config, toolType: value })}
          >
            <SelectTrigger id="toolType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ping">Ping</SelectItem>
              <SelectItem value="traceroute">Traceroute</SelectItem>
              <SelectItem value="port-scan">Port Scan</SelectItem>
              <SelectItem value="dns-lookup">DNS Lookup</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Target */}
        <div className="space-y-2">
          <Label htmlFor="target">Target</Label>
          <Input
            id="target"
            value={config.target ?? ""}
            onChange={(e) => onChange({ ...config, target: e.target.value || null })}
            disabled={isSaving}
            placeholder="hostname or IP address"
          />
        </div>

        {/* Parameters */}
        <div className="space-y-2">
          <Label htmlFor="parameters">Parameters (JSON)</Label>
          <Input
            id="parameters"
            value={config.parameters ?? ""}
            onChange={(e) => onChange({ ...config, parameters: e.target.value || null })}
            disabled={isSaving}
            placeholder='{"ports": [80, 443]}'
          />
        </div>

      </div>

      {/* Schedule Section */}
      <div className="space-y-2 pt-4 border-t">
        <Label>Schedule</Label>
        <CronExpressionEditor
          value={config.cron || "0 */5 * * * ?"}
          onChange={(newCron) => onChange({ ...config, cron: newCron })}
          disabled={isSaving}
        />
      </div>

      {/* Enabled Toggle */}
      <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
        <Switch
          id="enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          disabled={isSaving}
        />
        <div className="flex-1">
          <Label htmlFor="enabled" className="cursor-pointer">
            {config.enabled ? "Enabled" : "Disabled"}
          </Label>
          <p className="text-xs text-muted-foreground">
            {config.enabled 
              ? "Tool will run according to schedule" 
              : "Tool is paused"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// System Update Edit Form
export function SystemUpdateEditForm({
  config,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  config: SystemUpdateSettings;
  onChange: (config: SystemUpdateSettings) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="space-y-4">
        {/* Maintenance Window */}
        <div className="space-y-2">
          <Label htmlFor="maintenanceWindow">Maintenance Window (UTC)</Label>
          <Input
            id="maintenanceWindow"
            placeholder="HH:MM-HH:MM (e.g., 02:00-04:00)"
            value={config.maintenanceWindow || ""}
            onChange={(e) => onChange({ ...config, maintenanceWindow: e.target.value || null })}
            disabled={isSaving}
          />
        </div>

        {/* Update Types */}
        <div className="space-y-3">
          <Label className="text-base">Update Types</Label>

          <div className="flex items-center space-x-2">
            <Switch
              id="security"
              checked={config.includeSecurityUpdates}
              onCheckedChange={(checked) => onChange({ ...config, includeSecurityUpdates: checked })}
              disabled={isSaving}
            />
            <Label htmlFor="security">Security updates</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="feature"
              checked={config.includeFeatureUpdates}
              onCheckedChange={(checked) => onChange({ ...config, includeFeatureUpdates: checked })}
              disabled={isSaving}
            />
            <Label htmlFor="feature">Feature updates</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="driver"
              checked={config.includeDriverUpdates}
              onCheckedChange={(checked) => onChange({ ...config, includeDriverUpdates: checked })}
              disabled={isSaving}
            />
            <Label htmlFor="driver">Driver updates</Label>
          </div>
        </div>

        {/* Auto-approve Settings */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <Label htmlFor="autoApprove">Auto-approve Updates</Label>
            <Switch
              id="autoApprove"
              checked={config.autoApproveUpdates}
              onCheckedChange={(checked) => onChange({ ...config, autoApproveUpdates: checked })}
              disabled={isSaving}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="autoReboot">Auto-reboot if Needed</Label>
            <Switch
              id="autoReboot"
              checked={config.autoRebootIfNeeded}
              onCheckedChange={(checked) => onChange({ ...config, autoRebootIfNeeded: checked })}
              disabled={isSaving}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Agent Update Edit Form
export function AgentUpdateEditForm({
  config,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  config: AutoUpdateSettings;
  onChange: (config: AutoUpdateSettings) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Channel */}
        <div className="space-y-2">
          <Label htmlFor="channel">Update Channel</Label>
          <Select
            value={config.channel}
            onValueChange={(value) => value && onChange({ ...config, channel: value })}
          >
            <SelectTrigger id="channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">Stable</SelectItem>
              <SelectItem value="beta">Beta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Maintenance Window */}
        <div className="space-y-2">
          <Label htmlFor="maintenanceWindow">Maintenance Window (UTC)</Label>
          <Input
            id="maintenanceWindow"
            placeholder="HH:MM-HH:MM (e.g., 02:00-04:00)"
            value={config.maintenanceWindow || ""}
            onChange={(e) => onChange({ ...config, maintenanceWindow: e.target.value || null })}
            disabled={isSaving}
          />
        </div>

        {/* Approval Mode */}
        <div className="space-y-2">
          <Label htmlFor="approvalMode">Approval Mode</Label>
          <Select
            value={config.approvalMode}
            onValueChange={(value) => onChange({ ...config, approvalMode: value as "automatic" | "manual" })}
          >
            <SelectTrigger id="approvalMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual Approval</SelectItem>
              <SelectItem value="automatic">Automatic</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Global Job Edit Form (for agent-update and system-update jobs)
export function GlobalJobEditForm({
  jobType,
  schedule,
  enabled,
  onChange,
  onSave,
  onCancel,
  isSaving
}: {
  jobType: "agent-update" | "system-update";
  schedule: string;
  enabled: boolean;
  onChange: (data: { schedule: string; enabled: boolean }) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const jobLabel = jobType === "agent-update" ? "Agent Update" : "System Update";

  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg mt-3">
      <div className="text-sm text-muted-foreground p-3 bg-background rounded border">
        <p className="font-medium mb-1">{jobLabel} Job</p>
        <p>
          This is a global job that runs across all nodes. 
          {jobType === "agent-update" && " It checks for and applies agent updates to all managed nodes."}
          {jobType === "system-update" && " It checks for and applies OS-level system updates to all managed nodes."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schedule Editor */}
        <div className="space-y-2">
          <Label>Schedule</Label>
          <CronExpressionEditor
            value={schedule}
            onChange={(newSchedule) => onChange({ schedule: newSchedule, enabled })}
            disabled={isSaving}
          />
        </div>

        {/* Enabled Toggle */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="enabled">Job Status</Label>
            <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={(checked) => onChange({ schedule, enabled: checked })}
                disabled={isSaving}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {enabled ? "Enabled" : "Disabled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {enabled 
                    ? "Job will run according to schedule" 
                    : "Job is paused and will not run"}
                </p>
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="space-y-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
            <p className="text-xs font-medium text-blue-900 dark:text-blue-100">
              💡 Scheduling Tips
            </p>
            <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
              <li>Use presets for common schedules</li>
              <li>All times are in UTC timezone</li>
              <li>Changes take effect immediately</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button onClick={onCancel} variant="outline" disabled={isSaving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}
