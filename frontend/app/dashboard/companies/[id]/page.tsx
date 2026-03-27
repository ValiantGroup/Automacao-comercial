'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import {
  ArrowLeft, Globe, Phone, MapPin, Star,
  Brain, Users, MessageSquare, Clock,
} from 'lucide-react';
import Link from 'next/link';

interface Company { id: string; name: string; niche: string | null; city: string | null; state: string | null; phone: string | null; website: string | null; address: string | null; google_rating: number | null; google_reviews_count: number | null; ai_score: number | null; pipeline_stage: string; enrichment_status: string; }
interface Intelligence { summary: string | null; pain_points: string[]; fit_score: number | null; fit_justification: string | null; tech_stack: string[]; reputation_score: number | null; reputation_summary: string | null; linkedin_about: string | null; website_description: string | null; persona_priority: string | null; }
interface Stakeholder { id: string; name: string; normalized_role: string | null; raw_title: string | null; linkedin_url: string | null; email: string | null; phone: string | null; source: string | null; }
interface Message { id: string; channel: string; content: string; subject: string | null; status: string; created_at: string; }
interface PipelineEvent { id: string; type: string; payload: any; created_at: string; }

const TABS = ['Visão Geral', 'Stakeholders', 'Mensagens', 'Timeline'];

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      apiFetch(`/api/companies/${id}`),
      apiFetch(`/api/companies/${id}/intelligence`).catch(() => null),
      apiFetch(`/api/companies/${id}/stakeholders`),
      apiFetch(`/api/companies/${id}/messages`),
    ]).then(([comp, intel, stakeholders, msgs]) => {
      setCompany(comp);
      setIntel(intel);
      setStakeholders(stakeholders?.data || []);
      setMessages(msgs?.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-gray-400 animate-pulse">Carregando...</div>;
  if (!company) return <div className="p-6 text-gray-400">Empresa não encontrada.</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <Link href="/dashboard/companies" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      {/* Hero */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{company.name}</h1>
            <div className="flex items-center gap-4 mt-2 flex-wrap text-sm text-gray-400">
              {company.niche && <span>{company.niche}</span>}
              {company.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{company.city}, {company.state}</span>}
              {company.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{company.phone}</span>}
              {company.website && <a href={company.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-brand"><Globe className="w-3 h-3" />{company.website}</a>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {company.google_rating && (
              <div className="flex items-center gap-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5">
                <Star className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-yellow-400">{company.google_rating}</span>
                <span className="text-xs text-gray-500">({company.google_reviews_count})</span>
              </div>
            )}
            {company.ai_score !== null && (
              <div className="bg-brand/10 border border-brand/30 rounded-lg px-3 py-1.5 text-center">
                <p className="text-xs text-gray-400">Score IA</p>
                <p className="text-xl font-bold text-brand">{company.ai_score}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-card rounded-xl p-1 border border-surface-border w-fit">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === i ? 'bg-brand text-white' : 'text-gray-400 hover:text-white'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 0 && intel && (
        <div className="space-y-4 animate-fade-in">
          {intel.summary && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2"><Brain className="w-4 h-4 text-brand" /> Resumo</h3>
              <p className="text-gray-300 text-sm leading-relaxed">{intel.summary}</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {intel.pain_points?.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">🎯 Dores Identificadas</h3>
                <ul className="space-y-2">{intel.pain_points.map((p, i) => <li key={i} className="flex items-start gap-2 text-sm text-gray-400"><span className="text-red-400 mt-0.5">•</span>{p}</li>)}</ul>
              </div>
            )}
            {intel.tech_stack?.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">⚙️ Stack Tecnológico</h3>
                <div className="flex flex-wrap gap-2">{intel.tech_stack.map((t) => <span key={t} className="badge bg-blue-500/20 text-blue-400">{t}</span>)}</div>
              </div>
            )}
          </div>
          {intel.fit_justification && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">📊 Justificativa do Fit Score</h3>
              <p className="text-sm text-gray-400">{intel.fit_justification}</p>
            </div>
          )}
          {intel.reputation_summary && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">⭐ Reputação (Reclame Aqui)</h3>
              <p className="text-sm text-gray-400">{intel.reputation_summary}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 1 && (
        <div className="space-y-3 animate-fade-in">
          {stakeholders.length === 0 ? (
            <div className="card text-center text-gray-500 py-8"><Users className="w-8 h-8 mx-auto mb-2 opacity-40" /><p>Nenhum stakeholder encontrado</p></div>
          ) : stakeholders.map((s) => (
            <div key={s.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium text-white">{s.name}</p>
                <p className="text-sm text-gray-400">{s.normalized_role || s.raw_title || '—'}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  {s.email && <span>{s.email}</span>}
                  {s.phone && <span>{s.phone}</span>}
                </div>
              </div>
              {s.linkedin_url && (
                <a href={s.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs py-1.5">LinkedIn</a>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 2 && (
        <div className="space-y-3 animate-fade-in">
          {messages.length === 0 ? (
            <div className="card text-center text-gray-500 py-8"><MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" /><p>Nenhuma mensagem ainda</p></div>
          ) : messages.map((m) => (
            <div key={m.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`badge ${m.channel === 'whatsapp' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{m.channel}</span>
                  <span className={`badge ${m.status === 'sent' ? 'bg-green-500/20 text-green-400' : m.status === 'pending_review' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>{m.status}</span>
                </div>
                <span className="text-xs text-gray-500">{new Date(m.created_at).toLocaleDateString('pt-BR')}</span>
              </div>
              {m.subject && <p className="text-sm font-medium text-gray-300 mb-1">Assunto: {m.subject}</p>}
              <p className="text-sm text-gray-400 leading-relaxed">{m.content}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 3 && (
        <div className="card animate-fade-in">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2"><Clock className="w-4 h-4" /> Timeline</h3>
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">Sem eventos registrados</p>
          ) : (
            <div className="space-y-3">
              {events.map((e) => (
                <div key={e.id} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white">{e.type}</p>
                    <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
