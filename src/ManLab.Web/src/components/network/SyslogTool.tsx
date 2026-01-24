import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Trash2, PauseCircle, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import {
  clearSyslogMessages,
  getRecentSyslogMessages,
  getSyslogStatus,
  type SyslogMessage,
} from "@/api/networkApi";
import { cn } from "@/lib/utils";

const MAX_MESSAGES = 500;

const severityLabels = [
  "Emergency",
  "Alert",
  "Critical",
  "Error",
  "Warning",
  "Notice",
  "Info",
  "Debug",
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildRegex(pattern: string, useRegex: boolean) {
  if (!pattern.trim()) return null;
  if (!useRegex) return null;
  return new RegExp(pattern, "gi");
}

function matchesFilter(message: SyslogMessage, filter: string, regex: RegExp | null): boolean {
  const combined = `${message.host ?? ""} ${message.appName ?? ""} ${message.message}`.toLowerCase();
  if (!filter.trim()) return true;

  if (regex) {
    regex.lastIndex = 0;
    return regex.test(`${message.host ?? ""} ${message.appName ?? ""} ${message.message}`);
  }

  return combined.includes(filter.toLowerCase());
}

function highlightText(text: string, regex: RegExp | null) {
  if (!regex || !text) return text;

  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), match: false });
    }
    parts.push({ text: match[0], match: true });
    lastIndex = match.index + match[0].length;
    if (regex.lastIndex === match.index) {
      regex.lastIndex++;
    }
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return parts.map((part, index) =>
    part.match ? (
      <mark key={index} className="rounded bg-primary/20 px-1 text-primary">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    )
  );
}

export function SyslogTool() {
  const { isConnected, subscribeSyslog, unsubscribeSyslog, subscribeToSyslog } = useNetworkHub();
  const [messages, setMessages] = useState<SyslogMessage[]>([]);
  const [filter, setFilter] = useState("");
  const [regexEnabled, setRegexEnabled] = useState(false);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [paused, setPaused] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["network", "syslog", "status"],
    queryFn: getSyslogStatus,
  });

  const messagesQuery = useQuery({
    queryKey: ["network", "syslog", "recent"],
    queryFn: () => getRecentSyslogMessages(MAX_MESSAGES),
  });

  const refresh = useCallback(async () => {
    await Promise.all([statusQuery.refetch(), messagesQuery.refetch()]);
    setMessages([]);
  }, [messagesQuery, statusQuery]);

  useEffect(() => {
    if (!isConnected) return;

    subscribeSyslog().catch(() => {
      // ignore
    });

    const unsubscribe = subscribeToSyslog((message) => {
      if (paused) return;
      setMessages((prev) => {
        const base = prev.length > 0 ? prev : (messagesQuery.data ?? []);
        return [...base, message].slice(-MAX_MESSAGES);
      });
    });

    return () => {
      unsubscribe();
      unsubscribeSyslog().catch(() => {
        // ignore
      });
    };
  }, [isConnected, messagesQuery.data, paused, subscribeSyslog, subscribeToSyslog, unsubscribeSyslog]);

  const { regex, regexError } = useMemo(() => {
    if (!regexEnabled) {
      return { regex: null, regexError: null };
    }

    try {
      const built = buildRegex(filter, regexEnabled);
      return { regex: built, regexError: null };
    } catch (error) {
      return {
        regex: null,
        regexError: error instanceof Error ? error.message : "Invalid regex",
      };
    }
  }, [filter, regexEnabled]);

  const displayMessages = useMemo(() => {
    return messages.length > 0 ? messages : (messagesQuery.data ?? []);
  }, [messages, messagesQuery.data]);

  const filteredMessages = useMemo(() => {
    return displayMessages.filter((message) => matchesFilter(message, filter, regex));
  }, [displayMessages, filter, regex]);

  const handleClear = useCallback(async () => {
    await clearSyslogMessages();
    setMessages([]);
    await statusQuery.refetch();
  }, [statusQuery]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Syslog Receiver</h3>
            <p className="text-sm text-muted-foreground">
              Live UDP syslog ingestion with filters and highlights.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPaused((prev) => !prev)}>
              {paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
            <div className="flex items-center gap-2">
              <Badge variant={statusQuery.data?.isListening ? "default" : "destructive"}>
                {statusQuery.data?.isListening ? "Listening" : "Stopped"}
              </Badge>
              {statusQuery.data?.error && (
                <span className="text-xs text-destructive">{statusQuery.data.error}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Port {statusQuery.data?.port ?? "—"}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Buffer</div>
            <div className="text-sm font-medium">{statusQuery.data?.bufferedCount ?? messages.length} entries</div>
            <div className="text-xs text-muted-foreground">Dropped {statusQuery.data?.droppedCount ?? 0}</div>
          </div>
          <div className="space-y-2">
            <Input
              placeholder="Filter (host, app, message)"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Switch checked={regexEnabled} onCheckedChange={setRegexEnabled} />
                Regex
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={highlightEnabled} onCheckedChange={setHighlightEnabled} />
                Highlight
              </label>
              {regexError && <span className="text-destructive">{regexError}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-130">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">App</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {filteredMessages.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      No syslog messages yet.
                    </td>
                  </tr>
                )}
                {filteredMessages.map((message) => {
                  const severity = message.severity ?? -1;
                  const severityLabel = severity >= 0 && severity < severityLabels.length
                    ? severityLabels[severity]
                    : "Unknown";

                  return (
                    <tr key={message.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(message.receivedAtUtc)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{message.host ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{message.appName ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={severity <= 3 ? "destructive" : severity <= 5 ? "default" : "outline"}
                          className={cn(severity <= 3 && "bg-destructive/80")}
                        >
                          {severityLabel}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {highlightEnabled ? highlightText(message.message, regex) : message.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
