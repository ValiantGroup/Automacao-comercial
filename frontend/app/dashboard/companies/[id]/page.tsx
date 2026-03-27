'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Globe,
  Phone,
  MapPin,
  Star,
  Brain,
  Users,
  MessageSquare,
  Clock,
  Building2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { BrandLogo } from '@/components/brand-logo';

interface Company {
  id: string;
  name: string;
  niche: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  google_reviews_count: number | null;
  ai_score: number | null;
  pipeline_stage: string;
  enrichment_status: string;
}

interface Intelligence {
  summary: string | null;
  pain_points: string[];
  fit_score: number | null;
  fit_justification: string | null;
  tech_stack: string[];
  reputation_score: number | null;
  reputation_summary: string | null;
  linkedin_about: string | null;
  website_description: string | null;
  persona_priority: string | null;
}

interface Stakeholder {
  id: string;
  name: string;
  normalized_role: string | null;
  raw_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
}

interface Message {
  id: string;
  channel: string;
  content: string;
  subject: string | null;
  status: string;
  created_at: string;
}

interface TimelineItem {
  id: string;
  label: string;
  date: string;
}

const TABS = ['Visao geral', 'Stakeholders', 'Mensagens', 'Timeline'] as const;

function statusBadgeClass(status: string) {
  if (status === 'sent') return 'badge-success';
  if (status === 'pending_review') return 'badge-warning';
  if (status === 'failed') return 'badge-danger';
  return 'badge-neutral';
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      apiFetch(`/api/companies/${id}`),
      apiFetch(`/api/companies/${id}/intelligence`).catch(() => null),
      apiFetch(`/api/companies/${id}/stakeholders`).catch(() => ({ data: [] })),
      apiFetch(`/api/companies/${id}/messages`).catch(() => ({ data: [] })),
    ])
      .then(([comp, intelData, stakeholdersData, messagesData]) => {
        setCompany(comp);
        setIntel(intelData);
        setStakeholders(stakeholdersData?.data || []);
        setMessages(messagesData?.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!company) return [];

    const items: TimelineItem[] = [
      {
        id: `company-${company.id}`,
        label: `Empresa adicionada ao pipeline (${company.pipeline_stage})`,
        date: new Date().toISOString(),
      },
    ];

    messages.forEach((m) => {
      items.push({
        id: `msg-${m.id}`,
        label: `Mensagem ${m.channel} em status ${m.status}`,
        date: m.created_at,
      });
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [company, messages]);

  if (loading) {
    return (
      <div className="card flex items-center gap-4 p-6 animate-pulse">
        <div className="h-10 w-10 rounded-xl bg-[#1F2937]" />
        <div className="space-y-2">
          <div className="h-3 w-52 rounded bg-[#1F2937]" />
          <div className="h-3 w-40 rounded bg-[#1F2937]" />
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="card relative overflow-hidden py-14 text-center">
        <div className="mx-auto mb-4 w-16 opacity-50">
          <BrandLogo mode="icon" muted />
        </div>
        <p className="text-base font-semibold text-[#E6EDF3]">Empresa nao encontrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/companies"
        className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.1em] text-[#9BA7B4] transition-colors hover:text-[#E6EDF3]"
      >
        <ArrowLeft className="h-4 w-4" />
        VOLTAR PARA PIPELINE
      </Link>

      <section className="card relative overflow-hidden">
        <div className="logo-watermark w-14">
          <BrandLogo mode="icon" muted />
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-[#5C6673]">
              <Building2 className="h-3.5 w-3.5" /> ACCOUNT PROFILE
            </div>
            <h1 className="truncate text-2xl font-semibold text-[#E6EDF3]">{company.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[#9BA7B4]">
              {company.niche && <span>{company.niche}</span>}
              {company.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-[#5C6673]" />
                  {company.city}
                  {company.state ? `, ${company.state}` : ''}
                </span>
              )}
              {company.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 text-[#5C6673]" />
                  {company.phone}
                </span>
              )}
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#2ED1C8] hover:text-[#2ED1C8]"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {company.website}
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {company.google_rating !== null && (
              <div className="surface-soft inline-flex items-center gap-1.5 px-3 py-2">
                <Star className="h-4 w-4 text-[#F59E0B]" />
                <span className="text-sm font-semibold text-[#F59E0B]">{company.google_rating.toFixed(1)}</span>
                <span className="text-xs text-[#5C6673]">({company.google_reviews_count || 0})</span>
              </div>
            )}
            {company.ai_score !== null && (
              <div className="rounded-xl border border-[rgba(26,167,161,0.52)] bg-[rgba(20,128,124,0.16)] px-3 py-2 text-center">
                <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-[#9BA7B4]">SCORE IA</p>
                <p className="text-xl font-semibold text-[#2ED1C8]">{company.ai_score}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="inline-flex flex-wrap gap-1 rounded-2xl border border-[#1F2937] bg-[rgba(18,24,33,0.78)] p-1.5">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            onClick={() => setActiveTab(index)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === index
                ? 'bg-[linear-gradient(135deg,rgba(58,47,107,0.84)_0%,rgba(26,167,161,0.78)_100%)] text-[#E6EDF3]'
                : 'text-[#9BA7B4] hover:text-[#E6EDF3]'
            }`}
          >
            {tab}
          </button>
        ))}
      </section>

      {activeTab === 0 && (
        <section className="space-y-4 animate-fade-in">
          <div className="card">
            <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <Brain className="h-4 w-4 text-[#2ED1C8]" />
              Sintese executiva
            </h3>
            <p className="text-sm leading-relaxed text-[#9BA7B4]">{intel?.summary || 'Sem resumo disponivel no momento.'}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Dores identificadas</h4>
              {intel?.pain_points?.length ? (
                <ul className="mt-3 space-y-2">
                  {intel.pain_points.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="flex items-start gap-2 text-sm text-[#9BA7B4]">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#EF4444]" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#5C6673]">Sem dores mapeadas.</p>
              )}
            </div>

            <div className="card">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Stack tecnologico</h4>
              {intel?.tech_stack?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {intel.tech_stack.map((tech) => (
                    <span key={tech} className="badge badge-info">
                      {tech}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#5C6673]">Sem stack identificado.</p>
              )}
            </div>
          </div>

          <div className="card">
            <h4 className="text-sm font-semibold text-[#E6EDF3]">Justificativa do fit</h4>
            <p className="mt-2 text-sm text-[#9BA7B4]">{intel?.fit_justification || 'Sem justificativa registrada.'}</p>
          </div>

          <div className="card">
            <h4 className="text-sm font-semibold text-[#E6EDF3]">Reputacao e sinais externos</h4>
            <p className="mt-2 text-sm text-[#9BA7B4]">{intel?.reputation_summary || 'Sem dados de reputacao para esta empresa.'}</p>
          </div>
        </section>
      )}

      {activeTab === 1 && (
        <section className="space-y-3 animate-fade-in">
          {stakeholders.length === 0 ? (
            <div className="card relative overflow-hidden py-12 text-center">
              <div className="mx-auto mb-4 w-12 opacity-45">
                <BrandLogo mode="icon" muted />
              </div>
              <p className="text-sm font-semibold text-[#E6EDF3]">Nenhum stakeholder encontrado</p>
              <p className="mt-1 text-xs text-[#9BA7B4]">Aguardando enriquecimento de contatos desta conta.</p>
            </div>
          ) : (
            stakeholders.map((s) => (
              <article key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#E6EDF3]">{s.name}</p>
                  <p className="text-sm text-[#9BA7B4]">{s.normalized_role || s.raw_title || 'Cargo nao informado'}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[#5C6673]">
                    {s.email && <span>{s.email}</span>}
                    {s.phone && <span>{s.phone}</span>}
                  </div>
                </div>
                {s.linkedin_url && (
                  <a href={s.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn-outline">
                    Abrir LinkedIn
                  </a>
                )}
              </article>
            ))
          )}
        </section>
      )}

      {activeTab === 2 && (
        <section className="space-y-3 animate-fade-in">
          {messages.length === 0 ? (
            <div className="card relative overflow-hidden py-12 text-center">
              <div className="mx-auto mb-4 w-12 opacity-45">
                <BrandLogo mode="icon" muted />
              </div>
              <p className="text-sm font-semibold text-[#E6EDF3]">Nenhuma mensagem registrada</p>
              <p className="mt-1 text-xs text-[#9BA7B4]">As interacoes desta conta aparecerao aqui.</p>
            </div>
          ) : (
            messages.map((m) => (
              <article key={m.id} className="card">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${m.channel === 'whatsapp' ? 'badge-success' : 'badge-info'}`}>{m.channel}</span>
                    <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span>
                  </div>
                  <span className="text-xs text-[#5C6673]">{new Date(m.created_at).toLocaleDateString('pt-BR')}</span>
                </div>

                {m.subject && <p className="mb-1 text-sm font-semibold text-[#E6EDF3]">Assunto: {m.subject}</p>}
                <p className="text-sm leading-relaxed text-[#9BA7B4]">{m.content}</p>
              </article>
            ))
          )}
        </section>
      )}

      {activeTab === 3 && (
        <section className="card animate-fade-in">
          <h3 className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
            <Clock className="h-4 w-4 text-[#2ED1C8]" /> Timeline
          </h3>

          {timeline.length === 0 ? (
            <p className="text-sm text-[#5C6673]">Sem eventos registrados.</p>
          ) : (
            <div className="space-y-3">
              {timeline.map((event) => (
                <div key={event.id} className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#1AA7A1]" />
                  <div>
                    <p className="text-sm text-[#E6EDF3]">{event.label}</p>
                    <p className="text-xs text-[#5C6673]">{new Date(event.date).toLocaleString('pt-BR')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}