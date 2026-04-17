'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { CheckCircle2, XCircle, MessageSquare, Mail, RefreshCw, Send } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

interface PendingMessage {
  id: string;
  channel: string;
  content: string;
  subject: string | null;
  created_at: string;
  stakeholder_name?: string;
}

interface Stats {
  total_sent: number;
  total_opened: number;
  total_replied: number;
  pending_review: number;
}

export default function OutreachPage() {
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    try {
      const [msgs, s] = await Promise.all([
        apiFetch('/api/outreach/pending-review'),
        apiFetch('/api/outreach/stats'),
      ]);
      setMessages(msgs.data || []);
      setStats(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string) {
    setProcessing(id);
    try {
      await apiFetch(`/api/outreach/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  }

  async function reject(id: string) {
    setProcessing(id);
    try {
      await apiFetch(`/api/outreach/${id}/reject`, { method: 'POST', body: JSON.stringify({}) });
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  }

  return (
    <div className="space-y-5 overflow-y-auto px-6 pb-8 pt-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">OUTREACH GOVERNANCE</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">Aprovacao de mensagens</h1>
          <p className="mt-1 text-sm text-[#9BA7B4]">{messages.length} mensagens aguardando validacao</p>
        </div>

        <button onClick={loadData} className="btn-outline inline-flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      {stats && (
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric title="Pendentes" value={stats.pending_review} className="text-[#F59E0B]" />
          <Metric title="Enviadas" value={stats.total_sent} className="text-[#38BDF8]" />
          <Metric title="Abertas" value={stats.total_opened} className="text-[#22C55E]" />
          <Metric title="Responderam" value={stats.total_replied} className="text-[#2ED1C8]" />
        </section>
      )}

      {loading ? (
        <section className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-[142px] animate-pulse" />
          ))}
        </section>
      ) : messages.length === 0 ? (
        <section className="card relative overflow-hidden py-14 text-center">
          <div className="mx-auto mb-4 w-16 opacity-55">
            <BrandLogo mode="icon" muted />
          </div>
          <p className="text-lg font-semibold text-[#E6EDF3]">Fila de aprovacao vazia</p>
          <p className="mt-1 text-sm text-[#9BA7B4]">Todas as mensagens foram processadas.</p>
        </section>
      ) : (
        <section className="space-y-3">
          {messages.map((msg) => (
            <article key={msg.id} className="card border-l-2 border-l-[rgba(245,158,11,0.55)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`badge ${msg.channel === 'whatsapp' ? 'badge-success' : 'badge-info'}`}>
                    {msg.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                  </span>
                  {msg.stakeholder_name && (
                    <span className="text-sm text-[#9BA7B4]">
                      Para <strong className="text-[#E6EDF3]">{msg.stakeholder_name}</strong>
                    </span>
                  )}
                </div>
                <span className="text-xs text-[#5C6673]">{new Date(msg.created_at).toLocaleDateString('pt-BR')}</span>
              </div>

              {msg.subject && <p className="mb-1 text-sm font-semibold text-[#E6EDF3]">Assunto: {msg.subject}</p>}
              <p className="rounded-xl border border-[#1F2937] bg-[rgba(18,24,33,0.68)] p-3 text-sm leading-relaxed text-[#9BA7B4]">
                {msg.content}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => reject(msg.id)}
                  disabled={processing === msg.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.12)] px-3 py-2 text-xs font-semibold text-[#EF4444] transition-colors hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" />
                  Rejeitar
                </button>
                <button
                  onClick={() => approve(msg.id)}
                  disabled={processing === msg.id}
                  className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {processing === msg.id ? 'Enviando...' : 'Aprovar e enviar'}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function Metric({ title, value, className }: { title: string; value: number; className: string }) {
  return (
    <article className="card px-4 py-4 text-center">
      <p className={`text-2xl font-semibold ${className}`}>{value.toLocaleString('pt-BR')}</p>
      <p className="mt-1 text-[0.72rem] font-semibold tracking-[0.1em] text-[#5C6673]">{title}</p>
    </article>
  );
}