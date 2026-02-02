import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/components/use-theme";
import { DiscordSettings } from "@/components/settings/DiscordSettings";
import { AgentDefaultsSettings } from "@/components/settings/AgentDefaultsSettings";
import { ScriptsSettings } from "@/components/settings/ScriptsSettings";
import { GitHubReleaseSettings } from "@/components/settings/GitHubReleaseSettings";
import { NetworkSettings } from "@/components/settings/NetworkSettings";
import { AuthSettings } from "@/components/settings/AuthSettings";
import { ProcessMonitoringSettings } from "@/components/settings/ProcessMonitoringSettings";
import { NatsSettings } from "@/components/settings/NatsSettings";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  const normalizeServerBaseUrl = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";

    // If user pastes a full URL, keep it.
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, "");
    }

    // Allow protocol-relative URLs.
    if (trimmed.startsWith("//")) {
      return `${window.location.protocol}${trimmed}`.replace(/\/+$/, "");
    }

    // If they entered just host[:port], assume http.
    return `http://${trimmed}`.replace(/\/+$/, "");
  };

  // Initialize from localStorage directly to avoid effect sync issues
  const [serverUrl, setServerUrl] = useState(() => 
    localStorage.getItem("manlab:server_url") || window.location.origin
  );

  const handleSaveConnection = () => {
    const normalized = normalizeServerBaseUrl(serverUrl);
    if (normalized) {
        localStorage.setItem("manlab:server_url", normalized);
        // Force reload to apply new URL
        window.location.reload();
    } else {
        localStorage.removeItem("manlab:server_url");
    }
  };

  return (
    <div className="space-y-6 container mx-auto max-w-4xl pb-10 px-4 md:px-6">
      <div>
        <h3 className="text-lg font-medium">Settings</h3>
        <p className="text-sm text-muted-foreground">
          Manage your application preferences and configurations.
        </p>
      </div>
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="w-full flex-wrap h-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="scripts">Scripts</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
              <CardDescription>
                Select the color theme for the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                <Label htmlFor="theme">Interface Theme</Label>
                <Select value={theme} onValueChange={(val) => setTheme(val as "light" | "dark" | "system")}>
                  <SelectTrigger id="theme" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>
                Configure the server connection URL. Leave empty to use default (current origin).
              </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-2">
                    <Label htmlFor="server-url">Server URL</Label>
                    <Input 
                        id="server-url" 
                        value={serverUrl} 
                        onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://your-server.com"
                    />
                    <p className="text-[0.8rem] text-muted-foreground">
                        Changes will require a page reload.
                    </p>
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSaveConnection}>Save & Reload</Button>
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="security" className="space-y-4">
          <AuthSettings />
        </TabsContent>
        <TabsContent value="network" className="space-y-4">
          <NetworkSettings />
        </TabsContent>
        <TabsContent value="scripts" className="space-y-4">
            <ScriptsSettings />
        </TabsContent>
        <TabsContent value="agents" className="space-y-4">
            <AgentDefaultsSettings />
          <GitHubReleaseSettings />
        </TabsContent>
        <TabsContent value="notifications" className="space-y-4">
            <DiscordSettings />
        </TabsContent>
        <TabsContent value="monitoring" className="space-y-4">
            <ProcessMonitoringSettings />
            <NatsSettings />
        </TabsContent>

      </Tabs>
    </div>
  );
}
