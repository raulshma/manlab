import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

export function AgentDefaultsSettings() {
  const queryClient = useQueryClient();
  const [heartbeat, setHeartbeat] = useState("10");
  const [reconnectDelay, setReconnectDelay] = useState("120");

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  useEffect(() => {
    if (settings) {
      const hb = settings.find((s: SystemSetting) => s.key === SettingKeys.Agent.HeartbeatIntervalSeconds);
      if (hb?.value && hb.value !== heartbeat) setHeartbeat(hb.value);
      
      const rd = settings.find((s: SystemSetting) => s.key === SettingKeys.Agent.MaxReconnectDelaySeconds);
      if (rd?.value && rd.value !== reconnectDelay) setReconnectDelay(rd.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Agent defaults saved successfully.");
    },
    onError: (error) => {
        toast.error("Failed to save settings: " + error.message);
    }
  });

    const handleSave = () => {
    mutation.mutate([
      {
        key: SettingKeys.Agent.HeartbeatIntervalSeconds,
        value: heartbeat,
        category: "Agent",
        description: "Default heartbeat interval in seconds",
      },
      {
        key: SettingKeys.Agent.MaxReconnectDelaySeconds,
        value: reconnectDelay,
        category: "Agent",
        description: "Default max reconnect delay in seconds",
      },
    ]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Defaults</CardTitle>
        <CardDescription>
          Configure default settings for new agent installations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="heartbeat">Heartbeat Interval (Seconds)</Label>
          <Input
            id="heartbeat"
            type="number"
            value={heartbeat}
            onChange={(e) => setHeartbeat(e.target.value)}
          />
          <p className="text-[0.8rem] text-muted-foreground">
            How often the agent reports status to the server.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="reconnect">Max Reconnect Delay (Seconds)</Label>
          <Input
            id="reconnect"
            type="number"
            value={reconnectDelay}
            onChange={(e) => setReconnectDelay(e.target.value)}
          />
           <p className="text-[0.8rem] text-muted-foreground">
            Maximum wait time between connection retries.
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
