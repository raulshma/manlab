import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchOnboardingMachineForNode,
  fetchSuggestedServerBaseUrl,
  installAgent,
} from "@/api";
import { AgentVersionPicker, type AgentVersionSelection } from "@/components/AgentVersionPicker";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface NodeAgentUpdateModalProps {
  nodeId: string;
  hostname: string;
  channel: string;
}

export function NodeAgentUpdateModal({ nodeId, hostname, channel }: NodeAgentUpdateModalProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const machineQuery = useQuery({
    queryKey: ["onboardingMachineForNode", nodeId],
    queryFn: () => fetchOnboardingMachineForNode(nodeId),
    enabled: open,
    retry: false,
  });

  const suggestedUrlQuery = useQuery({
    queryKey: ["suggestedServerBaseUrl"],
    queryFn: fetchSuggestedServerBaseUrl,
    enabled: open,
    staleTime: 60_000,
  });

  const machine = machineQuery.data ?? null;

  const effectiveServerBaseUrl = useMemo(() => {
    const suggested = suggestedUrlQuery.data?.serverBaseUrl ?? "";
    if (!machine) return suggested;
    return machine.serverBaseUrlOverride ?? suggested;
  }, [machine, suggestedUrlQuery.data]);

  // Keep user edits as overrides; fall back to persisted machine defaults.
  const [trustHostKeyOverride, setTrustHostKeyOverride] = useState<boolean | null>(null);
  const [runAsRootOverride, setRunAsRootOverride] = useState<boolean | null>(null);
  const [forceOverride, setForceOverride] = useState<boolean | null>(null);

  const trustHostKey = trustHostKeyOverride ?? machine?.trustHostKey ?? true;
  const runAsRoot = runAsRootOverride ?? machine?.runAsRoot ?? false;
  const force = forceOverride ?? machine?.forceInstall ?? true;

  const [password, setPassword] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [sudoPassword, setSudoPassword] = useState("");

  const [useSavedCredentials, setUseSavedCredentials] = useState(true);

  // Keep agent selection channel derived from props, while storing source/version as user state.
  const [agentSelectionCore, setAgentSelectionCore] = useState<Pick<AgentVersionSelection, "source" | "version">>({
    source: "local",
    version: "staged",
  });

  const agentSelection: AgentVersionSelection = useMemo(
    () => ({ ...agentSelectionCore, channel }),
    [agentSelectionCore, channel]
  );

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!machine) throw new Error("No onboarding machine linked to this node.");

      // If user isn't using saved creds, require something appropriate to auth mode.
      if (!useSavedCredentials) {
        if (machine.authMode === "Password" && !password.trim()) {
          throw new Error("Password is required.");
        }
        if (machine.authMode === "PrivateKey" && !privateKeyPem.trim()) {
          throw new Error("Private key PEM is required.");
        }
      }

      const res = await installAgent(machine.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        force,
        runAsRoot,
        trustHostKey,
        agentSource: agentSelection.source,
        agentChannel: agentSelection.channel,
        agentVersion: agentSelection.version,
        // If using saved creds, omit secrets so the server can decrypt saved values.
        password: useSavedCredentials ? undefined : password,
        privateKeyPem: useSavedCredentials ? undefined : privateKeyPem,
        privateKeyPassphrase: useSavedCredentials ? undefined : privateKeyPassphrase,
        sudoPassword: useSavedCredentials ? undefined : sudoPassword,
        useSavedCredentials,
      });

      return res;
    },
    onSuccess: async () => {
      toast.info("Agent update started", {
        description: "Check the Onboarding logs for progress.",
      });
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachineForNode", nodeId] });
      setOpen(false);
    },
    onError: (err) => {
      toast.error("Failed to start agent update", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const noLinkedMachine = machineQuery.isError;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Update Agent Version…</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update ManLab Agent</DialogTitle>
          <DialogDescription>
            Reinstall/update the agent on <span className="font-mono">{hostname}</span> via SSH.
          </DialogDescription>
        </DialogHeader>

        {noLinkedMachine ? (
          <Alert variant="destructive">
            <AlertDescription>
              This node is not linked to an onboarding machine. Use the Onboarding modal to add/link the machine first.
            </AlertDescription>
          </Alert>
        ) : null}

        {machineQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading machine info…</div>
        ) : null}

        {machine ? (
          <div className="space-y-4">
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs text-muted-foreground">Target</div>
              <div className="font-mono text-sm">
                {machine.username}@{machine.host}:{machine.port}
              </div>
              <div className="text-xs text-muted-foreground">Auth mode: {machine.authMode}</div>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="text-xs text-muted-foreground">Agent version</div>
              <AgentVersionPicker
                channel={channel}
                value={agentSelection}
                onChange={(next) => setAgentSelectionCore({ source: next.source, version: next.version })}
              />
            </div>

            <div className="rounded border p-3 space-y-3">
              <div className="text-xs text-muted-foreground">Install options</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={force} onCheckedChange={(c) => setForceOverride(c === true)} />
                Force re-install
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={runAsRoot} onCheckedChange={(c) => setRunAsRootOverride(c === true)} />
                Run as root
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={trustHostKey} onCheckedChange={(c) => setTrustHostKeyOverride(c === true)} />
                Trust host key
              </label>
            </div>

            <div className="rounded border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Credentials</div>
                  <div className="text-sm">Use saved credentials (recommended)</div>
                </div>
                <Checkbox
                  checked={useSavedCredentials}
                  onCheckedChange={(c) => setUseSavedCredentials(c === true)}
                  disabled={machine.hasSavedCredentials !== true && machine.hasSavedSudoPassword !== true}
                />
              </div>

              {useSavedCredentials && (machine.hasSavedCredentials !== true && machine.hasSavedSudoPassword !== true) ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    No saved credentials are available for this machine. Disable “Use saved credentials” and enter credentials below, or open Onboarding to save them.
                  </AlertDescription>
                </Alert>
              ) : null}

              {!useSavedCredentials ? (
                <div className="space-y-2">
                  {machine.authMode === "Password" ? (
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="SSH password"
                    />
                  ) : (
                    <>
                      <Textarea
                        value={privateKeyPem}
                        onChange={(e) => setPrivateKeyPem(e.target.value)}
                        placeholder="Private key PEM"
                        className="font-mono text-xs"
                        rows={6}
                      />
                      <Input
                        type="password"
                        value={privateKeyPassphrase}
                        onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                        placeholder="Private key passphrase (optional)"
                      />
                    </>
                  )}

                  <Input
                    type="password"
                    value={sudoPassword}
                    onChange={(e) => setSudoPassword(e.target.value)}
                    placeholder="Sudo password (optional)"
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={installMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => installMutation.mutate()}
            disabled={!machine || installMutation.isPending || !effectiveServerBaseUrl}
          >
            {installMutation.isPending ? "Starting…" : "Start update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
