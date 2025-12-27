/**
 * TerminalPanel - Restricted terminal for remote command execution.
 * Provides gated access with warning, expiry countdown, and I/O.
 */

import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  openTerminalSession,
  sendTerminalInput,
  closeTerminalSession,
} from "../api";
import type { TerminalOpenResponse } from "../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertTriangle,
  Terminal,
  Clock,
  Power,
  PowerOff,
  Send,
} from "lucide-react";

interface TerminalPanelProps {
  nodeId: string;
  nodeStatus?: string;
}

// Helper to format countdown timer
function formatCountdown(expiresAt: string): string {
  const expiresDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiresDate.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Maximum buffer size for terminal output (64KB)
const MAX_OUTPUT_BYTES = 64 * 1024;

// Helper to append output while enforcing buffer limit
function appendWithLimit(prev: string, newContent: string): string {
  const combined = prev + newContent;
  if (combined.length > MAX_OUTPUT_BYTES) {
    // Truncate oldest content, keeping the newest
    return "[...output truncated...]\n" + combined.slice(-MAX_OUTPUT_BYTES + 30);
  }
  return combined;
}

export function TerminalPanel({
  nodeId,
  nodeStatus = "Online",
}: TerminalPanelProps) {
  const [session, setSession] = useState<TerminalOpenResponse | null>(null);
  const [expiryCountdown, setExpiryCountdown] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [inputValue, setInputValue] = useState<string>("");
  const [showWarning, setShowWarning] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expiry countdown timer - uses interval to update countdown, not sync setState
  useEffect(() => {
    if (!session) return;

    const updateCountdown = () => {
      const countdown = formatCountdown(session.expiresAt);
      setExpiryCountdown(countdown);
      if (countdown === "Expired") {
        setSession(null);
        setTerminalOutput((prev) => appendWithLimit(prev, "\n\n[Session expired]\n"));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [session]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // Focus input when session starts
  useEffect(() => {
    if (session && inputRef.current) {
      inputRef.current.focus();
    }
  }, [session]);

  // Open session mutation
  const openMutation = useMutation({
    mutationFn: () => openTerminalSession(nodeId, 300), // 5 minute TTL
    onSuccess: (response) => {
      setSession(response);
      setTerminalOutput(`[Terminal session started]\n[Expires in 5 minutes]\n[Warning: ${response.warning}]\n\n`);
      setShowWarning(false);
    },
  });

  // Send input mutation
  const sendMutation = useMutation({
    mutationFn: (input: string) => {
      if (!session) throw new Error("No session");
      return sendTerminalInput(nodeId, session.sessionId, input);
    },
    onSuccess: (_, input) => {
      // Echo input to terminal with buffer limit
      setTerminalOutput((prev) => appendWithLimit(prev, `$ ${input}\n`));
      setInputValue("");
      // Note: actual output would come via SignalR, but for now we just echo
      // In a real implementation, you would listen for terminalOutput events
      setTerminalOutput((prev) => appendWithLimit(prev, `[Command sent. Waiting for response...]\n`));
    },
  });

  // Close session mutation
  const closeMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error("No session");
      return closeTerminalSession(nodeId, session.sessionId);
    },
    onSuccess: () => {
      setTerminalOutput((prev) => appendWithLimit(prev, "\n[Session closed]\n"));
      setSession(null);
    },
  });

  const handleSend = () => {
    if (inputValue.trim() && session) {
      sendMutation.mutate(inputValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isOnline = nodeStatus === "Online";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Terminal</CardTitle>
              <CardDescription>
                Restricted remote command execution (ephemeral, audited)
              </CardDescription>
            </div>
          </div>
          {session && (
            <Badge
              variant={expiryCountdown === "Expired" ? "destructive" : "outline"}
              className="flex items-center gap-1"
            >
              <Clock className="h-3 w-3" />
              {expiryCountdown}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!session ? (
          // Not in session - show enable button with warning
          <div className="space-y-4">
            {showWarning && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Security Notice</AlertTitle>
                <AlertDescription className="text-sm">
                  The terminal provides direct command execution on the remote node.
                  All commands are logged and audited. Sessions automatically expire
                  after 5 minutes. Only use this feature when necessary.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-4">
              <Button
                onClick={() => openMutation.mutate()}
                disabled={!isOnline || openMutation.isPending}
                className="flex-1"
              >
                {openMutation.isPending ? (
                  <>
                    <Spinner className="h-4 w-4 mr-2" />
                    Opening...
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-2" />
                    Enable Terminal
                  </>
                )}
              </Button>
            </div>

            {openMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {openMutation.error instanceof Error
                    ? openMutation.error.message
                    : "Failed to open terminal session"}
                </AlertDescription>
              </Alert>
            )}

            {!isOnline && (
              <p className="text-xs text-muted-foreground">
                ⚠️ Terminal is only available when the node is online.
              </p>
            )}
          </div>
        ) : (
          // Active session - show terminal
          <div className="space-y-4">
            {/* Terminal Output */}
            <pre
              ref={outputRef}
              className="bg-zinc-900 text-green-400 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap overflow-auto h-64 min-h-48"
            >
              {terminalOutput || "$ "}
            </pre>

            {/* Input */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-1">
                <span className="text-green-400 font-mono text-sm">$</span>
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter command..."
                  className="flex-1 bg-transparent border-none text-green-400 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                  disabled={sendMutation.isPending}
                />
              </div>
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim() || sendMutation.isPending}
                size="icon"
              >
                {sendMutation.isPending ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? (
                  <Spinner className="h-4 w-4 mr-2" />
                ) : (
                  <PowerOff className="h-4 w-4 mr-2" />
                )}
                Close
              </Button>
            </div>

            {sendMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {sendMutation.error instanceof Error
                    ? sendMutation.error.message
                    : "Failed to send command"}
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              Note: Terminal output is delivered asynchronously. Complex commands may
              take time to complete.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
