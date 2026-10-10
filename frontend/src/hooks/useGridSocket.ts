import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientAction, TelemetryPacket } from '../types';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export const MAX_RECONNECT_DELAY_MS = 10_000;

export function defaultSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL?.trim();
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.hostname || 'localhost'}:8000/ws/grid-telemetry`;
}

export function isTelemetryPacket(data: unknown): data is TelemetryPacket {
  if (!data || typeof data !== 'object') return false;
  const p = data as Partial<TelemetryPacket>;
  return (
    typeof p.sim_hour === 'number' &&
    Array.isArray(p.zones) &&
    Array.isArray(p.workloads) &&
    typeof p.ai_explanation === 'object' &&
    p.ai_explanation !== null &&
    typeof p.cumulative_metrics === 'object' &&
    p.cumulative_metrics !== null
  );
}

export function reconnectDelay(attempt: number): number {
  return Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** attempt);
}

/** Streams TelemetryPackets from the backend and sends scenario actions back. Auto-reconnects. */
export function useGridSocket(url: string = defaultSocketUrl()) {
  const [packet, setPacket] = useState<TelemetryPacket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(url);
      socketRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
      };
      ws.onmessage = (event: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(String(event.data));
          if (isTelemetryPacket(data)) setPacket(data);
        } catch {
          // ignore malformed frames — the next tick will arrive in 1.5s
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (disposed) return;
        setStatus('closed');
        retryTimer = setTimeout(connect, reconnectDelay(attempt++));
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [url]);

  const sendAction = useCallback((action: ClientAction): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(action));
    return true;
  }, []);

  return { packet, status, connected: status === 'open', sendAction };
}
