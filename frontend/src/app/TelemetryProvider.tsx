import { createContext, useContext, type ReactNode } from 'react';
import { useGridSocket } from '../hooks/useGridSocket';

type Telemetry = ReturnType<typeof useGridSocket>;

const TelemetryContext = createContext<Telemetry | null>(null);

/** One WebSocket for the whole app, so switching routes never reconnects or drops state. */
export function TelemetryProvider({ children }: { children: ReactNode }) {
  const telemetry = useGridSocket();
  return <TelemetryContext.Provider value={telemetry}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): Telemetry {
  const value = useContext(TelemetryContext);
  if (!value) throw new Error('useTelemetry must be used inside <TelemetryProvider>');
  return value;
}
