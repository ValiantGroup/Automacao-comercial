'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, Dot } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

interface FeedEvent {
  id: string;
  type: string;
  payload: any;
  time: Date;
}

const EVENT_LABELS: Record<string, string> = {
  ai_analyzed: 'Empresa analisada pela IA',
  message_generated: 'Mensagem gerada',
  message_sent: 'Mensagem enviada',
  message_approved: 'Mensagem aprovada',
  stage_changed: 'Estagio atualizado',
  enrichment_done: 'Enriquecimento concluido',
  campaign_search_started: 'Busca de campanha iniciada',
  campaign_search_progress: 'Busca de campanha em progresso',
  campaign_search_finished: 'Busca de campanha finalizada',
  campaign_search_limit_reached: 'Limite de campanha atingido',
};

const WS_URL = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000' : '';

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
        } catch {
          // noop
        }
      };

      ws.onclose = () => {
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  function handleToggle() {
    setOpen((prev) => !prev);
    if (!open) setUnread(0);
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60]">
      {open && (
        <div className="mb-3 w-[320px] overflow-hidden rounded-2xl border border-[#1F2937] bg-[linear-gradient(180deg,rgba(26,35,48,0.92)_0%,rgba(18,24,33,0.96)_100%)] shadow-[0_24px_48px_rgba(11,15,20,0.52)] animate-slide-up">
          <header className="relative border-b border-[#1F2937] px-4 py-3.5">
            <div className="absolute right-3 top-3 w-8 opacity-15">
              <BrandLogo mode="icon" muted />
            </div>
            <p className="text-xs font-semibold tracking-[0.14em] text-[#5C6673]">LIVE TELEMETRY</p>
            <div className="mt-1 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Feed operacional</h4>
              <span className="text-xs text-[#9BA7B4]">{events.length} eventos</span>
            </div>
          </header>

          <div className="max-h-[350px] divide-y divide-[#1F2937] overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[#5C6673]">Aguardando atividade...</div>
            ) : (
              events.map((ev) => (
                <article key={ev.id} className="px-4 py-3 transition-colors hover:bg-[rgba(26,35,48,0.75)]">
                  <p className="text-sm font-medium text-[#E6EDF3]">{EVENT_LABELS[ev.type] || ev.type}</p>
                  {(ev.payload?.company_name || ev.payload?.name || ev.payload?.campaign_id) && (
                    <p className="mt-0.5 text-xs text-[#9BA7B4]">
                      {ev.payload?.company_name || ev.payload?.name || `Campanha ${String(ev.payload?.campaign_id).slice(0, 8)}`}
                    </p>
                  )}
                  {ev.payload?.reason && (
                    <p className="mt-0.5 text-[0.68rem] text-[#5C6673]">motivo: {String(ev.payload.reason)}</p>
                  )}
                  <p className="mt-1 text-[0.7rem] tracking-[0.08em] text-[#5C6673]">
                    {ev.time.toLocaleTimeString('pt-BR')}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      )}

      <button
        onClick={handleToggle}
        className="group relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(26,167,161,0.48)] bg-[linear-gradient(135deg,rgba(58,47,107,0.88)_0%,rgba(26,167,161,0.88)_100%)] text-[#E6EDF3] shadow-[0_14px_30px_rgba(26,167,161,0.24)] transition-transform hover:-translate-y-[1px]"
      >
        <Activity className="h-5 w-5" />
        <span className="pointer-events-none absolute inset-0 rounded-full border border-[rgba(230,237,243,0.2)]" />

        {unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border border-[rgba(239,68,68,0.62)] bg-[rgba(239,68,68,0.92)] px-1 text-[0.63rem] font-bold text-[#E6EDF3]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}

        <span className="absolute -bottom-1.5 left-1/2 inline-flex -translate-x-1/2 items-center text-[#2ED1C8]">
          <Dot className="h-6 w-6 animate-shimmer" />
        </span>
      </button>
    </div>
  );
}
