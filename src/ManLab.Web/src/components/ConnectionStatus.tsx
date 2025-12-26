/**
 * ConnectionStatus component showing the current SignalR connection state.
 */

import { useSignalR, type ConnectionStatus as Status } from '../SignalRContext';

/**
 * Returns styles and label for the connection status.
 */
function getConnectionStyles(status: Status): {
  dotClass: string;
  label: string;
} {
  switch (status) {
    case 'connected':
      return {
        dotClass: 'bg-emerald-500',
        label: 'Connected',
      };
    case 'connecting':
      return {
        dotClass: 'bg-blue-500 animate-pulse',
        label: 'Connecting...',
      };
    case 'reconnecting':
      return {
        dotClass: 'bg-amber-500 animate-pulse',
        label: 'Reconnecting...',
      };
    case 'disconnected':
      return {
        dotClass: 'bg-red-500',
        label: 'Disconnected',
      };
    default:
      return {
        dotClass: 'bg-slate-500',
        label: 'Unknown',
      };
  }
}

/**
 * ConnectionStatus component that displays the current WebSocket connection state.
 */
export function ConnectionStatus() {
  const { connectionStatus } = useSignalR();
  const styles = getConnectionStyles(connectionStatus);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded-lg">
      <div className={`w-2 h-2 rounded-full ${styles.dotClass}`} />
      <span className="text-xs text-slate-400">{styles.label}</span>
    </div>
  );
}
