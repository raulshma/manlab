import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

export function DiscordSettings() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [isTestLoading, setIsTestLoading] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  useEffect(() => {
    if (settings) {
      const urlSetting = settings.find((s: SystemSetting) => s.key === SettingKeys.Discord.WebhookUrl);
      const enabledSetting = settings.find((s: SystemSetting) => s.key === SettingKeys.Discord.Enabled);

      if (urlSetting?.value) {
        setWebhookUrl(urlSetting.value);
      }

      if (enabledSetting) {
        setEnabled(enabledSetting.value === "true");
      } else if (urlSetting?.value) {
        // Legacy: if URL exists but Enabled key missing, assume enabled
        setEnabled(true);
      }
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Discord settings saved successfully.");
    },
    onError: (error) => {
        toast.error("Failed to save settings: " + error.message);
    }
  });

  const handleSave = () => {
    mutation.mutate([
      {
        key: SettingKeys.Discord.WebhookUrl,
        value: webhookUrl,
        category: "Notifications",
        description: "Discord Webhook URL for alerts",
      },
      {
        key: SettingKeys.Discord.Enabled,
        value: enabled ? "true" : "false",
        category: "Notifications",
        description: "Enable Discord notifications",
      },
    ]);
  };

  const handleTest = async () => {
    if (!webhookUrl) return;
    setIsTestLoading(true);
    try {
      await api.post("/api/settings/test-discord", webhookUrl);
      toast.success("Test message sent successfully!");
    } catch (err) {
      toast.error("Failed to send test message: " + (err as Error).message);
    } finally {
      setIsTestLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord Notifications</CardTitle>
        <CardDescription>
          Receive alerts in your Discord server when nodes go offline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="discord-enable"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="discord-enable">Enable Discord Webhook</Label>
        </div>
        {enabled && (
          <div className="grid gap-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
            />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={handleTest} disabled={!enabled || !webhookUrl || isTestLoading}>
            {isTestLoading ? "Sending..." : "Send Test Message"}
        </Button>
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
