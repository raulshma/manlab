import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

export function NatsSettings() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  // Calculate server state
  const serverEnabled = settings?.find((s: SystemSetting) => s.key === SettingKeys.Nats.UiEnabled)?.value === "true";

  // Local override for UI interactivity
  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);

  // Effective state: local override takes precedence if set, otherwise server state
  const enabled = localEnabled ?? serverEnabled ?? false;
  


  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("NATS settings saved successfully.");
    },
    onError: (error) => {
        toast.error("Failed to save settings: " + error.message);
    }
  });

  const handleSave = () => {
    mutation.mutate([
      {
        key: SettingKeys.Nats.UiEnabled,
        value: enabled ? "true" : "false",
        category: "System",
        description: "Enable NATS Dashboard UI",
      },
    ]);
  };

  const getNatsUiUrl = () => {
      // Use non-standard port 14222 to avoid conflicts
      return `${window.location.protocol}//${window.location.hostname}:14222`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>NATS Dashboard</CardTitle>
        <CardDescription>
          Enable the NATS UI (NUI) to inspect the messaging system.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="nats-enable"
            checked={enabled}
            onCheckedChange={setLocalEnabled}
          />
          <Label htmlFor="nats-enable">Enable NATS UI</Label>
        </div>
        
        {enabled && (
             <div className="mt-4 p-4 border rounded-md bg-muted/50">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-medium">Dashboard Access</h4>
                        <p className="text-xs text-muted-foreground">
                            Access the NATS UI running on port 3100.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => window.open(getNatsUiUrl(), '_blank')}>
                        Open NCN <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground p-2 bg-background/50 rounded border border-dashed">
                    <strong>Connection Hint:</strong> Use <code>nats://nats:4222</code> to connect to the internal server.
                </div>
             </div>
        )}

      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
