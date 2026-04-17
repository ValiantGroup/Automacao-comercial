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
  Mail,
  AlertTriangle,
  Link2,
  ShieldAlert,
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
  raw_web_data?: RawWebData | null;
}

interface RawWebData {
  captured_at?: string;
  website_url?: string | null;
  website_description?: string;
  tech_stack?: string[];
  reputation_summary?: string;
  website?: {
    title?: string;
    description?: string;
    text_content?: string;
    technologies?: string[];
    links?: string[];
    final_url?: string;
    source?: string;
    pages_count?: number;
    pages_scanned?: string[];
    scanned_page_summaries?: Array<{
      url?: string;
      title?: string;
      description?: string;
    }>;
    headings?: {
      h1?: string[];
      h2?: string[];
      h3?: string[];
    };
    contact_signals?: {
      emails?: string[];
      phones?: string[];
      whatsapp_numbers?: string[];
      addresses?: string[];
      social_links?: string[];
      contact_pages?: string[];
    };
    site_signals?: {
      has_contact_form?: boolean;
      has_whatsapp_cta?: boolean;
      has_live_chat?: boolean;
      has_about_page?: boolean;
      has_blog?: boolean;
      has_careers_page?: boolean;
      has_privacy_policy?: boolean;
      has_terms_page?: boolean;
      has_robots_meta?: boolean;
      has_favicon?: boolean;
      is_https?: boolean;
    };
    business_signals?: {
      what_company_does?: string[];
      value_propositions?: string[];
      target_market_hints?: string[];
      location_hints?: string[];
      cta_phrases?: string[];
    };
    issues?: Array<{
      code?: string;
      severity?: string;
      message?: string;
    }>;
  };
  reclame_aqui?: {
    found?: boolean;
    profile_url?: string;
    company_name?: string;
    company_slug?: string;
    score?: number;
    solution_rate?: number;
    complaints_count?: number;
    responded_percentage?: number | null;
    would_do_business_again_percentage?: number | null;
    consumer_score?: number | null;
    response_time_text?: string;
    response_time_days?: number | null;
    complaint_topics?: string[];
    recent_complaints?: string[];
    summary?: string;
    indicators?: Record<string, string>;
  };
  derived?: {
    what_company_does?: string[];
    location_hints?: string[];
    site_issues?: string[];
    pain_signals?: string[];
    ai_about_company?: string;
    ai_what_company_does?: string[];
    ai_core_offers?: string[];
    ai_location_hints?: string[];
    ai_pain_hypotheses?: string[];
    ai_confidence?: number;
  };
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

function issueBadgeClass(severity: string | undefined) {
  if (severity === 'high') return 'badge-danger';
  if (severity === 'medium') return 'badge-warning';
  if (severity === 'low') return 'badge-info';
  return 'badge-neutral';
}

function uniq(values: string[] = []) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function isLikelyNoiseText(text: string): boolean {
  const value = (text || '').toLowerCase().trim();
  if (!value) return true;
  return (
    value.includes('404') ||
    value.includes('page not found') ||
    value.includes('pagina nao encontrada') ||
    value.includes('oops') ||
    value.includes('clique aqui')
  );
}

function normalizeComparableIssue(text: string): string {
  return text
    .replace(/^\s*\[[A-Z]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeURLValue(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((param) =>
      parsed.searchParams.delete(param),
    );
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function uniqURLs(values: string[] = []) {
  return Array.from(new Set(values.map((v) => normalizeURLValue(v)).filter(Boolean)));
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

  const rawWeb = intel?.raw_web_data || null;
  const websiteData = rawWeb?.website;
  const reclameAquiData = rawWeb?.reclame_aqui;
  const aboutCompany = rawWeb?.derived?.ai_about_company || intel?.website_description || rawWeb?.website_description || null;
  const coreOffers = useMemo(
    () => uniq(rawWeb?.derived?.ai_core_offers || []).filter((value) => !isLikelyNoiseText(value)).slice(0, 10),
    [rawWeb],
  );

  const whatCompanyDoes = useMemo(
    () =>
      uniq([
        ...(rawWeb?.derived?.ai_what_company_does || []),
        ...(rawWeb?.derived?.what_company_does || []),
        ...(websiteData?.business_signals?.what_company_does || []),
        ...(websiteData?.headings?.h1 || []),
      ])
        .filter((value) => !isLikelyNoiseText(value))
        .slice(0, 10),
    [rawWeb, websiteData],
  );

  const locationHints = useMemo(
    () =>
      uniq([
        ...(rawWeb?.derived?.ai_location_hints || []),
        ...(rawWeb?.derived?.location_hints || []),
        ...(websiteData?.business_signals?.location_hints || []),
        ...(websiteData?.contact_signals?.addresses || []),
      ])
        .filter((value) => !isLikelyNoiseText(value))
        .slice(0, 8),
    [rawWeb, websiteData],
  );

  const contactSignals = useMemo(
    () => ({
      emails: uniq(websiteData?.contact_signals?.emails || []),
      phones: uniq(websiteData?.contact_signals?.phones || []),
      whatsapp: uniq(websiteData?.contact_signals?.whatsapp_numbers || []),
      social: uniqURLs(websiteData?.contact_signals?.social_links || []),
      pages: uniqURLs(websiteData?.contact_signals?.contact_pages || []),
    }),
    [websiteData],
  );

  const websiteIssues = useMemo(() => {
    const merged = [
      ...(websiteData?.issues || []).map((issue) => ({
        severity: issue.severity || 'unknown',
        message: issue.message || issue.code || 'Issue detectada',
      })),
      ...(rawWeb?.derived?.site_issues || []).map((message) => ({
        severity: 'unknown',
        message,
      })),
    ].filter((issue) => issue.message && issue.message.trim().length > 0);

    const unique: Array<{ severity: string; message: string }> = [];
    const seen = new Set<string>();
    merged.forEach((issue) => {
      const key = normalizeComparableIssue(issue.message);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(issue);
    });
    return unique.slice(0, 18);
  }, [websiteData, rawWeb]);

  const relevantLinks = useMemo(
    () => uniqURLs(websiteData?.links || []).slice(0, 24),
    [websiteData],
  );

  const scannedPages = useMemo(
    () => uniqURLs(websiteData?.pages_scanned || []),
    [websiteData],
  );

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
    <div className="space-y-5 space-y-5 overflow-y-auto px-6 pb-8 pt-6 md:px-8">
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card">
              <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Brain className="h-4 w-4 text-[#2ED1C8]" />
                O que a empresa faz
              </h4>
              {aboutCompany && (
                <p className="mt-3 text-sm leading-relaxed text-[#9BA7B4]">{aboutCompany}</p>
              )}
              {whatCompanyDoes.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {whatCompanyDoes.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="flex items-start gap-2 text-sm text-[#9BA7B4]">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2ED1C8]" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#5C6673]">
                  Sem inferencia clara da atuacao no site.
                </p>
              )}

              {coreOffers.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">OFERTAS E FRENTES PRINCIPAIS</p>
                  <div className="flex flex-wrap gap-2">
                    {coreOffers.map((offer) => (
                      <span key={offer} className="badge badge-info">
                        {offer}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {locationHints.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">
                    <MapPin className="h-3.5 w-3.5" />
                    PISTAS DE LOCALIZACAO
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {locationHints.map((hint) => (
                      <span key={hint} className="badge badge-info">
                        {hint}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Mail className="h-4 w-4 text-[#2ED1C8]" />
                Contatos detectados no site
              </h4>

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#9BA7B4]">
                <p>Emails: <span className="font-semibold text-[#E6EDF3]">{contactSignals.emails.length}</span></p>
                <p>Telefones: <span className="font-semibold text-[#E6EDF3]">{contactSignals.phones.length}</span></p>
                <p>WhatsApp: <span className="font-semibold text-[#E6EDF3]">{contactSignals.whatsapp.length}</span></p>
              </div>

              {(contactSignals.emails.length > 0 || contactSignals.phones.length > 0 || contactSignals.whatsapp.length > 0) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {contactSignals.emails.map((email) => (
                    <span key={email} className="badge badge-info">{email}</span>
                  ))}
                  {contactSignals.phones.map((phone) => (
                    <span key={phone} className="badge badge-neutral">{phone}</span>
                  ))}
                  {contactSignals.whatsapp.map((wa) => (
                    <span key={wa} className="badge badge-success">{wa}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#5C6673]">Nenhum contato explicito detectado no site.</p>
              )}

              {(contactSignals.pages.length > 0 || contactSignals.social.length > 0) && (
                <div className="mt-4 space-y-2">
                  {contactSignals.pages.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">PAGINAS DE CONTATO</p>
                      <div className="flex flex-wrap gap-2">
                        {contactSignals.pages.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="badge badge-info hover:opacity-90">
                            {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {contactSignals.social.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">REDES SOCIAIS</p>
                      <div className="flex flex-wrap gap-2">
                        {contactSignals.social.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="badge badge-neutral hover:opacity-90">
                            {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
              Problemas detectados no site
            </h4>
            {websiteIssues.length > 0 ? (
              <div className="mt-3 space-y-2">
                {websiteIssues.map((issue, idx) => (
                  <div key={`${issue.message}-${idx}`} className="flex flex-wrap items-start gap-2">
                    <span className={`badge ${issueBadgeClass(issue.severity)}`}>{issue.severity}</span>
                    <p className="flex-1 text-sm text-[#9BA7B4]">{issue.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#5C6673]">Nenhum problema explicito detectado pelo crawler.</p>
            )}
          </div>

          <div className="card">
            <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <ShieldAlert className="h-4 w-4 text-[#2ED1C8]" />
              Reclame Aqui detalhado
            </h4>

            {reclameAquiData?.found ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {typeof reclameAquiData.score === 'number' && (
                    <span className="badge badge-warning">Nota {reclameAquiData.score.toFixed(1)}/10</span>
                  )}
                  {typeof reclameAquiData.solution_rate === 'number' && (
                    <span className="badge badge-info">Solucao {(reclameAquiData.solution_rate * 100).toFixed(0)}%</span>
                  )}
                  {typeof reclameAquiData.complaints_count === 'number' && (
                    <span className="badge badge-neutral">{reclameAquiData.complaints_count} reclamacoes</span>
                  )}
                  {typeof reclameAquiData.responded_percentage === 'number' && (
                    <span className="badge badge-info">{reclameAquiData.responded_percentage.toFixed(0)}% respondidas</span>
                  )}
                </div>

                {reclameAquiData.profile_url && (
                  <a
                    href={reclameAquiData.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-[#2ED1C8] hover:text-[#7EE7E2]"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    ABRIR PERFIL NO RECLAME AQUI
                  </a>
                )}

                {reclameAquiData.complaint_topics && reclameAquiData.complaint_topics.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">TOPICOS RECORRENTES</p>
                    <div className="flex flex-wrap gap-2">
                      {reclameAquiData.complaint_topics.map((topic) => (
                        <span key={topic} className="badge badge-danger">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {reclameAquiData.recent_complaints && reclameAquiData.recent_complaints.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-[#5C6673]">RECLAMACOES RECENTES</p>
                    <ul className="space-y-1.5">
                      {reclameAquiData.recent_complaints.slice(0, 8).map((complaint, idx) => (
                        <li key={`${complaint}-${idx}`} className="text-sm text-[#9BA7B4]">
                          - {complaint}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#5C6673]">Sem perfil validado no Reclame Aqui para esta empresa.</p>
            )}
          </div>

          <div className="card">
            <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <Link2 className="h-4 w-4 text-[#2ED1C8]" />
              Links mapeados no site
            </h4>
            {typeof websiteData?.pages_count === 'number' && websiteData.pages_count > 0 && (
              <p className="mt-2 text-xs text-[#5C6673]">
                Paginas internas varridas: {websiteData.pages_count}
              </p>
            )}

            {websiteData?.scanned_page_summaries && websiteData.scanned_page_summaries.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {websiteData.scanned_page_summaries.slice(0, 8).map((page, idx) => (
                  <p key={`${page.url || 'page'}-${idx}`} className="text-xs text-[#9BA7B4]">
                    {page.title || page.url || `Pagina ${idx + 1}`}
                  </p>
                ))}
              </div>
            )}

            {scannedPages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {scannedPages.slice(0, 12).map((url) => (
                  <a
                    key={`scan-${url}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="badge badge-neutral hover:opacity-90"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}

            {relevantLinks.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {relevantLinks.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[#1F2937] bg-[rgba(18,24,33,0.6)] px-2.5 py-1 text-xs text-[#9BA7B4] hover:text-[#E6EDF3]"
                    title={url}
                  >
                    <Globe className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{url}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#5C6673]">Nenhum link adicional mapeado no crawl.</p>
            )}
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
