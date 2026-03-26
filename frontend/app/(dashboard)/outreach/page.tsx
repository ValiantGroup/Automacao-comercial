'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { CheckCircle, XCircle, MessageSquare, Mail, RefreshCw } from 'lucide-react';

interface PendingMessage {
  id: string;
  company_id: string;
  channel: string;
  content: string;
  subject: string | null;
  status: string;
  created_at: string;
  // Joined
  company_name?: string;
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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Aprovação de Mensagens</h1>
          <p className="text-gray-400 mt-1">{messages.length} mensagens aguardando revisão</p>
        </div>
        <button onClick={loadData} className="btn-outline flex items-center gap-2 text-sm">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Pendentes', value: stats.pending_review, color: 'text-amber-400' },
            { label: 'Enviadas', value: stats.total_sent, color: 'text-blue-400' },
            { label: 'Abertas', value: stats.total_opened, color: 'text-green-400' },
            { label: 'Responderam', value: stats.total_replied, color: 'text-brand' },
          ].map((s) => (
            <div key={s.label} className="card py-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-28 animate-pulse bg-surface-card" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3 opacity-60" />
          <p className="text-white font-medium">Nenhuma mensagem pendente</p>
          <p className="text-sm text-gray-500 mt-1">Todas as mensagens foram revisadas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="card animate-fade-in border-l-4 border-l-amber-500/50">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {msg.channel === 'whatsapp' ? (
                    <span className="badge bg-green-500/20 text-green-400 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> WhatsApp
                    </span>
                  ) : (
                    <span className="badge bg-blue-500/20 text-blue-400 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email
                    </span>
                  )}
                  {msg.stakeholder_name && (
                    <span className="text-sm text-gray-300">Para: <strong>{msg.stakeholder_name}</strong></span>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(msg.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>

              {/* Content */}
              {msg.subject && (
                <p className="text-sm font-semibold text-gray-200 mb-1">Assunto: {msg.subject}</p>
              )}
              <p className="text-sm text-gray-300 leading-relaxed bg-surface rounded-lg p-3 border border-surface-border">
                {msg.content}
              </p>

              {/* Actions */}
              <div className="flex gap-2 mt-3 justify-end">
                <button
                  onClick={() => reject(msg.id)}
                  disabled={processing === msg.id}
                  className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Rejeitar
                </button>
                <button
                  onClick={() => approve(msg.id)}
                  disabled={processing === msg.id}
                  className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  {processing === msg.id ? 'Enviando...' : 'Aprovar & Enviar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
