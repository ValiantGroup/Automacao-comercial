'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

interface FeedEvent {
  id: string;
  type: string;
  payload: any;
  time: Date;
}

const EVENT_LABELS: Record<string, string> = {
  ai_analyzed: '🧠 Empresa analisada',
  message_generated: '✉️ Mensagem gerada',
  message_sent: '📤 Mensagem enviada',
  message_approved: '✅ Mensagem aprovada',
  stage_changed: '🔄 Estágio atualizado',
  enrichment_done: '🔍 Enriquecimento concluído',
};

const WS_URL = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000')
  : '';

export function RealtimeFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    function connect() {
      const token = localStorage.getItem('access_token');
      const url = `${WS_URL}/ws${token ? `?token=${token}` : ''}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          const newEvent: FeedEvent = {
            id: Math.random().toString(36).slice(2),
            type: event.type,
            payload: event.payload,
            time: new Date(),
          };
          setEvents((prev) => [newEvent, ...prev].slice(0, 50));
          setUnread((u) => u + 1);
        } catch {}
      };

      ws.onclose = () => {
        setTimeout(connect, 3000); // Reconnect
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  function handleOpen() {
    setOpen((o) => !o);
    if (!open) setUnread(0);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Panel */}
      {open && (
        <div className="mb-3 w-72 bg-surface-card border border-surface-border rounded-xl shadow-2xl animate-slide-up overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Feed em tempo real</span>
            <span className="text-xs text-gray-500">{events.length} eventos</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-surface-border">
            {events.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Aguardando eventos...</div>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="px-4 py-2.5 hover:bg-surface-hover transition-colors">
                  <p className="text-xs font-medium text-white">
                    {EVENT_LABELS[ev.type] || ev.type}
                  </p>
                  {ev.payload?.company_name && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{ev.payload.company_name}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-0.5">
                    {ev.time.toLocaleTimeString('pt-BR')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-12 h-12 rounded-full bg-brand shadow-lg hover:bg-brand-dark transition-colors"
      >
        <Activity className="w-5 h-5 text-white" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {/* Pulse */}
        <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-20" />
      </button>
    </div>
  );
}
