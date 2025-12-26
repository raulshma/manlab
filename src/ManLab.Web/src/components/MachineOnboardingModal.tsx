import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  TextField,
  Input,
  Label,
  TextArea,
  Select,
  Popover,
  ListBox,
  ListBoxItem,
} from 'react-aria-components';
import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createOnboardingMachine,
  fetchOnboardingMachines,
  fetchSuggestedServerBaseUrl,
  installAgent,
  testSshConnection,
  uninstallAgent,
} from '../api';
import type {
  OnboardingMachine,
  OnboardingStatus,
  SshAuthMode,
  SshTestResponse,
} from '../types';
import { useSignalR } from '../SignalRContext';
import { ConfirmationModal } from './ConfirmationModal';

const EMPTY_MACHINES: OnboardingMachine[] = [];

function StatusBadge({ status }: { status: OnboardingStatus }) {
  const style =
    status === 'Succeeded'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : status === 'Failed'
        ? 'bg-red-500/20 text-red-300 border-red-500/30'
        : status === 'Running'
          ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
          : 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  return (
    <span className={`inline-flex items-center px-2 py-1 text-xs border rounded-md ${style}`}>
      {status}
    </span>
  );
}

export function MachineOnboardingModal({ trigger }: { trigger: ReactNode }) {
  const queryClient = useQueryClient();
  const { connection } = useSignalR();

  const machinesQuery = useQuery({
    queryKey: ['onboardingMachines'],
    queryFn: fetchOnboardingMachines,
    staleTime: 5000,
  });

  const machines = machinesQuery.data ?? EMPTY_MACHINES;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo<OnboardingMachine | null>(() => {
    if (!selectedId) return machines[0] ?? null;
    return machines.find((m) => m.id === selectedId) ?? null;
  }, [machines, selectedId]);

  // Add machine form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMode, setAuthMode] = useState<SshAuthMode>('PrivateKey');

  // Per-selected machine auth inputs (secrets are NOT persisted server-side)
  const [password, setPassword] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('');
  const [trustHostKey, setTrustHostKey] = useState(false);
  const [lastTest, setLastTest] = useState<SshTestResponse | null>(null);
  // Use a ref to track if user has manually edited the server base URL
  const serverBaseUrlDirtyRef = useRef(false);
  const [serverBaseUrlOverride, setServerBaseUrlOverride] = useState<string | null>(null);
  const [forceInstall, setForceInstall] = useState(true);

  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);

  // Subscribe to onboarding progress events
  useEffect(() => {
    if (!connection) return;

    const handleLog = (machineId: string, timestamp: string, message: string) => {
      if (selected && machineId !== selected.id) return;

      setLogs((old) => {
        const next = [...old, { ts: timestamp, msg: message }];
        return next.slice(-300);
      });
    };

    const handleStatus = (machineId: string) => {
      // Refresh machine list when status changes.
      queryClient.invalidateQueries({ queryKey: ['onboardingMachines'] });
      if (selected && machineId === selected.id) {
        // Keep UI fresh; no-op beyond invalidation.
      }
    };

    connection.on('OnboardingLog', handleLog);
    connection.on('OnboardingStatusChanged', handleStatus);

    return () => {
      connection.off('OnboardingLog', handleLog);
      connection.off('OnboardingStatusChanged', handleStatus);
    };
  }, [connection, queryClient, selected]);

  const suggestedServerBaseUrlQuery = useQuery({
    queryKey: ['onboardingSuggestedServerBaseUrl'],
    queryFn: fetchSuggestedServerBaseUrl,
    staleTime: 60_000,
    retry: 1,
  });

  // Compute serverBaseUrl as a derived value instead of using setState in useEffect.
  // Priority: user override > env variable > suggested URL from backend > window origin
  const serverBaseUrl = useMemo(() => {
    if (serverBaseUrlOverride !== null) {
      return serverBaseUrlOverride;
    }
    if (import.meta.env.VITE_SERVER_BASE_URL) {
      return import.meta.env.VITE_SERVER_BASE_URL as string;
    }
    const suggested = suggestedServerBaseUrlQuery.data?.trim();
    if (suggested) {
      return suggested;
    }
    return import.meta.env.VITE_API_URL ?? window.location.origin;
  }, [serverBaseUrlOverride, suggestedServerBaseUrlQuery.data]);

  // Handler to update server base URL when user edits
  const handleServerBaseUrlChange = (value: string) => {
    serverBaseUrlDirtyRef.current = true;
    setServerBaseUrlOverride(value);
  };

  const selectMachine = (id: string) => {
    setSelectedId(id);
    setLogs([]);
    setLastTest(null);
    setTrustHostKey(false);
  };

  const createMachineMutation = useMutation({
    mutationFn: createOnboardingMachine,
    onSuccess: async (m) => {
      await queryClient.invalidateQueries({ queryKey: ['onboardingMachines'] });
      selectMachine(m.id);
      setHost('');
      setPort('22');
      setUsername('');
      setAuthMode('PrivateKey');
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No machine selected');
      return testSshConnection(selected.id, {
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        trustHostKey,
      });
    },
    onSuccess: async (res) => {
      setLastTest(res);
      await queryClient.invalidateQueries({ queryKey: ['onboardingMachines'] });
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No machine selected');
      return installAgent(selected.id, {
        serverBaseUrl,
        force: forceInstall,
        trustHostKey,
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboardingMachines'] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No machine selected');
      return uninstallAgent(selected.id, {
        serverBaseUrl,
        trustHostKey,
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboardingMachines'] });
    },
  });

  const isBusy =
    createMachineMutation.isPending ||
    testMutation.isPending ||
    installMutation.isPending ||
    uninstallMutation.isPending;

  return (
    <DialogTrigger>
      {trigger}
      <ModalOverlay
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm
                   data-entering:animate-[fadeIn_200ms] data-exiting:animate-[fadeOut_150ms]"
      >
        <Modal
          className="w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl
                     p-0 m-4 outline-none data-entering:animate-[zoomIn_200ms] data-exiting:animate-[zoomOut_150ms]"
        >
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col max-h-[85vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                  <Heading slot="title" className="text-lg font-semibold text-white">
                    Machine Onboarding (SSH)
                  </Heading>
                  <Button
                    onPress={close}
                    className="px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Close
                  </Button>
                </div>

                <div className="p-6 overflow-auto">
                  {/* Add machine */}
                  <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white">Add machine</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <TextField value={host} onChange={setHost}>
                        <Label className="text-xs text-slate-300">Host</Label>
                        <Input className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" placeholder="192.168.1.10" />
                      </TextField>

                      <TextField value={port} onChange={setPort}>
                        <Label className="text-xs text-slate-300">Port</Label>
                        <Input className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" placeholder="22" />
                      </TextField>

                      <TextField value={username} onChange={setUsername}>
                        <Label className="text-xs text-slate-300">Username</Label>
                        <Input className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" placeholder="root" />
                      </TextField>

                      <div>
                        <Label className="text-xs text-slate-300">Auth mode</Label>
                        <Select
                          selectedKey={authMode}
                          onSelectionChange={(k) => setAuthMode(String(k) as SshAuthMode)}
                          className="mt-1"
                        >
                          <Button className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white text-left">
                            {authMode}
                          </Button>
                          <Popover className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl mt-1">
                            <ListBox>
                              <ListBoxItem id="PrivateKey" className="px-3 py-2 text-sm text-white cursor-pointer hover:bg-slate-800">PrivateKey</ListBoxItem>
                              <ListBoxItem id="Password" className="px-3 py-2 text-sm text-white cursor-pointer hover:bg-slate-800">Password</ListBoxItem>
                            </ListBox>
                          </Popover>
                        </Select>
                      </div>
                    </div>

                    <div className="flex justify-end mt-3">
                      <Button
                        isDisabled={isBusy}
                        onPress={() =>
                          createMachineMutation.mutate({
                            host,
                            port: Number(port || '22'),
                            username,
                            authMode,
                          })
                        }
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Add
                      </Button>
                    </div>

                    {createMachineMutation.isError && (
                      <p className="text-sm text-red-300 mt-2">
                        {createMachineMutation.error instanceof Error
                          ? createMachineMutation.error.message
                          : 'Failed to add machine'}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Machine list */}
                    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-white mb-3">Inventory</h3>

                      {machinesQuery.isLoading && (
                        <p className="text-sm text-slate-400">Loading…</p>
                      )}

                      {machinesQuery.isError && (
                        <p className="text-sm text-red-300">
                          {machinesQuery.error instanceof Error
                            ? machinesQuery.error.message
                            : 'Failed to load machines'}
                        </p>
                      )}

                      {machines.length === 0 ? (
                        <p className="text-sm text-slate-400">No machines yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {machines.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => selectMachine(m.id)}
                              className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${
                                selected?.id === m.id
                                  ? 'border-blue-500/50 bg-blue-500/10'
                                  : 'border-slate-700 hover:bg-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm text-white font-medium">
                                    {m.host}:{m.port}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {m.username} • {m.authMode}
                                  </div>
                                </div>
                                <StatusBadge status={m.status} />
                              </div>
                              {m.lastError && (
                                <div className="text-xs text-red-300 mt-1 truncate">
                                  {m.lastError}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Selected machine actions */}
                    <div className="lg:col-span-2 bg-slate-800/40 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-white">Connection & Install</h3>
                        {selected && <StatusBadge status={selected.status} />}
                      </div>

                      {!selected ? (
                        <p className="text-sm text-slate-400">Select a machine to begin.</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {selected.authMode === 'Password' ? (
                              <TextField value={password} onChange={setPassword}>
                                <Label className="text-xs text-slate-300">SSH password</Label>
                                <Input type="password" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" />
                              </TextField>
                            ) : (
                              <>
                                <TextField value={privateKeyPassphrase} onChange={setPrivateKeyPassphrase}>
                                  <Label className="text-xs text-slate-300">Key passphrase (optional)</Label>
                                  <Input type="password" className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" />
                                </TextField>
                                <div className="md:col-span-2">
                                  <TextField value={privateKeyPem} onChange={setPrivateKeyPem}>
                                    <Label className="text-xs text-slate-300">Private key (PEM/OpenSSH)</Label>
                                    <TextArea className="mt-1 w-full min-h-32 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n..." />
                                  </TextField>
                                </div>
                              </>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className="text-xs text-slate-300">Host key fingerprint</div>
                            <div className="text-sm text-slate-100 font-mono mt-1 break-all">
                              {selected.hostKeyFingerprint ?? 'Not trusted yet'}
                            </div>
                            <label className="flex items-center gap-2 mt-2 text-sm text-slate-300">
                              <input
                                type="checkbox"
                                checked={trustHostKey}
                                onChange={(e) => setTrustHostKey(e.target.checked)}
                              />
                              Trust host key (TOFU) for this machine
                            </label>
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <TextField
                              value={serverBaseUrl}
                              onChange={handleServerBaseUrlChange}
                            >
                              <Label className="text-xs text-slate-300">Server base URL (reachable from target)</Label>
                              <Input className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white" placeholder="http://your-server:5247" />
                            </TextField>

                            <div className="flex items-end">
                              <label className="flex items-center gap-2 text-sm text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={forceInstall}
                                  onChange={(e) => setForceInstall(e.target.checked)}
                                />
                                Force reinstall
                              </label>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 mt-4">
                            <Button
                              isDisabled={isBusy}
                              onPress={() => testMutation.mutate()}
                              className="px-4 py-2 bg-slate-700/60 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Test connection
                            </Button>

                            <ConfirmationModal
                              trigger={
                                <Button
                                  isDisabled={isBusy || !lastTest?.success}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Install agent
                                </Button>
                              }
                              title="Install ManLab Agent"
                              message={`This will connect to ${selected.host}:${selected.port} over SSH and run the installer. The target must be root or have passwordless sudo (Linux), or elevated PowerShell (Windows). Continue?`}
                              confirmText="Install"
                              isLoading={installMutation.isPending}
                              onConfirm={async () => {
                                setLogs([]);
                                await installMutation.mutateAsync();
                              }}
                            />

                            <ConfirmationModal
                              trigger={
                                <Button
                                  isDisabled={isBusy || !lastTest?.success}
                                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Uninstall agent
                                </Button>
                              }
                              title="Uninstall ManLab Agent"
                              message={`This will connect to ${selected.host}:${selected.port} over SSH and remove the ManLab agent service/task and installed files. Continue?`}
                              confirmText="Uninstall"
                              isLoading={uninstallMutation.isPending}
                              onConfirm={async () => {
                                setLogs([]);
                                await uninstallMutation.mutateAsync();
                              }}
                            />

                            {!lastTest?.success && (
                              <span className="text-sm text-slate-400">
                                Run <span className="font-medium text-slate-200">Test connection</span> before installing.
                              </span>
                            )}

                            {lastTest?.requiresHostKeyTrust && (
                              <span className="text-sm text-amber-300">
                                Host key trust required. Fingerprint: {lastTest.hostKeyFingerprint}
                              </span>
                            )}
                          </div>

                          {testMutation.isError && (
                            <p className="text-sm text-red-300 mt-2">
                              {testMutation.error instanceof Error
                                ? testMutation.error.message
                                : 'SSH test failed'}
                            </p>
                          )}

                          {lastTest && (
                            <div className="mt-4 bg-slate-900/60 border border-slate-700 rounded-lg p-3">
                              <div className="text-xs text-slate-400 mb-1">Test result</div>
                              <div className="text-sm text-white">
                                {lastTest.success ? 'Connected' : 'Failed'}
                              </div>
                              <div className="text-xs text-slate-300 mt-1">
                                whoami: <span className="font-mono">{lastTest.whoAmI ?? '—'}</span>
                              </div>
                              <div className="text-xs text-slate-300 mt-1">
                                os: <span className="font-mono">{lastTest.osHint ?? '—'}</span>
                              </div>
                              {lastTest.error && (
                                <div className="text-xs text-red-300 mt-2">
                                  {lastTest.error}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="mt-4">
                            <div className="text-xs text-slate-400 mb-2">Job logs (live)</div>
                            <div className="bg-black/30 border border-slate-700 rounded-lg p-3 max-h-64 overflow-auto">
                              {logs.length === 0 ? (
                                <div className="text-sm text-slate-500">
                                  No logs yet. Start a job to see progress.
                                </div>
                              ) : (
                                <pre className="text-xs text-slate-200 whitespace-pre-wrap">
                                  {logs
                                    .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.msg}`)
                                    .join('\n')}
                                </pre>
                              )}
                            </div>
                          </div>

                          {selected.linkedNodeId && (
                            <div className="mt-4 text-sm text-emerald-300">
                              Linked node: <span className="font-mono">{selected.linkedNodeId}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
