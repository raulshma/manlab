/**
 * ConnectionStatus component showing the current SignalR connection state.
 */

import { useSignalR, type ConnectionStatus as Status } from '../SignalRContext';
import { Badge } from '@/components/ui/badge';

/**
 * Returns badge variant and label for the connection status.
 */
function getConnectionInfo(status: Status): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  label: string;
  animate?: boolean;
} {
  switch (status) {
    case 'connected':
      return { variant: 'default', label: 'Connected' };
    case 'connecting':
      return { variant: 'secondary', label: 'Connecting...', animate: true };
    case 'reconnecting':
      return { variant: 'secondary', label: 'Reconnecting...', animate: true };
    case 'disconnected':
      return { variant: 'destructive', label: 'Disconnected' };
    default:
      return { variant: 'outline', label: 'Unknown' };
  }
}

/**
 * ConnectionStatus component that displays the current WebSocket connection state.
 */
export function ConnectionStatus() {
  const { connectionStatus } = useSignalR();
  const info = getConnectionInfo(connectionStatus);

  return (
    <Badge 
      variant={info.variant}
      className={info.animate ? 'animate-pulse' : undefined}
    >
      {info.label}
    </Badge>
  );
}
