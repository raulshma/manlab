import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { SettingKeys } from "@/constants/settingKeys";
import { api } from "@/api";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";

const DEFAULT_LOCAL_CIDRS = "127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, fc00::/7, fe80::/10";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

const DEFAULTS = {
  authEnabled: false,
  localBypassEnabled: false,
  localBypassCidrs: "",
};

export function AuthSettings() {
  const queryClient = useQueryClient();
  const { status, changePassword } = useAuth();
  const [overrides, setOverrides] = useState<Partial<typeof DEFAULTS>>({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get<SystemSetting[]>("/api/settings")).data,
  });

  const serverValues = useMemo(() => {
    if (!data) return DEFAULTS;
    const get = (key: string, fallback: string) => data.find((s) => s.key === key)?.value ?? fallback;
    return {
      authEnabled: get(SettingKeys.Auth.Enabled, "false") === "true",
      localBypassEnabled: get(SettingKeys.Auth.LocalBypassEnabled, "false") === "true",
      localBypassCidrs: get(SettingKeys.Auth.LocalBypassCidrs, "") || "",
    };
  }, [data]);

  const values = useMemo(() => ({ ...serverValues, ...overrides }), [serverValues, overrides]);

  const updateField = useCallback(<K extends keyof typeof DEFAULTS>(key: K, value: (typeof DEFAULTS)[K]) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = [
        {
          key: SettingKeys.Auth.Enabled,
          value: values.authEnabled ? "true" : "false",
          category: "Auth",
          description: "Require authentication for the dashboard and API.",
        },
        {
          key: SettingKeys.Auth.LocalBypassEnabled,
          value: values.localBypassEnabled ? "true" : "false",
          category: "Auth",
          description: "Allow local network clients to bypass authentication.",
        },
        {
          key: SettingKeys.Auth.LocalBypassCidrs,
          value: values.localBypassCidrs.trim() || null,
          category: "Auth",
          description: "Comma-separated CIDR list for local bypass (empty uses defaults).",
        },
      ];
      await api.post("/api/settings", payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Authentication settings saved");
    },
    onError: (err) => {
      toast.error(`Failed to save settings: ${(err as Error).message}`);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!newPassword) {
        throw new Error("New password is required.");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      await changePassword(currentPassword, newPassword);
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => {
      toast.error(`Failed to update password: ${(err as Error).message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription>
          Secure the dashboard with JWT authentication and optionally allow local network bypass.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner className="h-5 w-5" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load settings: {(error as Error).message}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Require authentication</Label>
                <p className="text-xs text-muted-foreground">
                  Enable this to require a login for all dashboard and API access.
                </p>
              </div>
              <Switch
                checked={values.authEnabled}
                onCheckedChange={(checked) => updateField("authEnabled", checked)}
                aria-label="Require authentication"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Local network bypass</Label>
                <p className="text-xs text-muted-foreground">
                  Allow trusted local subnets to bypass auth (Sonarr/Radarr-style).
                </p>
              </div>
              <Switch
                checked={values.localBypassEnabled}
                onCheckedChange={(checked) => updateField("localBypassEnabled", checked)}
                aria-label="Local network bypass"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="auth-bypass-cidrs">Allowed CIDRs</Label>
              <Textarea
                id="auth-bypass-cidrs"
                placeholder={DEFAULT_LOCAL_CIDRS}
                value={values.localBypassCidrs}
                onChange={(e) => updateField("localBypassCidrs", e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use defaults: {DEFAULT_LOCAL_CIDRS}
              </p>
            </div>

            {status?.authMethod === "local-bypass" && (
              <Alert>
                <AlertDescription>
                  You are accessing the dashboard via local network bypass ({status.clientIp}).
                </AlertDescription>
              </Alert>
            )}

            {!status?.passwordSet && values.authEnabled && (
              <Alert variant="destructive">
                <AlertDescription>
                  Authentication is enabled, but no admin password is set. Use the setup screen or set a password first.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                Save Authentication Settings
              </Button>
            </div>

            <div className="border-t pt-6 space-y-4">
              <div>
                <Label className="text-sm font-medium">Change admin password</Label>
                <p className="text-xs text-muted-foreground">
                  Update the admin password for dashboard access.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm-new-password">Confirm new password</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => passwordMutation.mutate()}
                  disabled={passwordMutation.isPending}
                >
                  {passwordMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                  Update Password
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
