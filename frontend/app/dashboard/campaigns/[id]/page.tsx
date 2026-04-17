'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Play, Pause, Radar, Activity } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
  niche: string;
  city: string;
  radius_km: number;
  status: string;
  daily_limit: number;
  auto_send: boolean;
  channels: string[];
  created_at: string;
  min_google_reviews: number;
  max_companies: number;
  min_ai_score_for_stakeholders: number;
}

interface CampaignProgress {
  campaign_id: string;
  status: string;
  overall_progress_pct: number;
  search_progress_pct: number;
  target_max_companies: number;
  companies_in_campaign: number;
  analyzed_companies: number;
  stakeholders_found: number;
  messages_generated: number;
  search: {
    total_found: number;
    processed: number;
    saved: number;
    skipped_low_reviews: number;
    skipped_duplicate: number;
    skipped_type: number;
    errors: number;
    last_started_at?: string | null;
    last_finished_at?: string | null;
  };
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingProgress, setRefreshingProgress] = useState(false);

  useEffect(() => {
    if (!id) return;

    let active = true;

    async function loadAll(initialLoad = false) {
      if (initialLoad) setLoading(true);
      if (!initialLoad) setRefreshingProgress(true);
      try {
        const [campaignData, progressData] = await Promise.all([
          apiFetch(`/api/campaigns/${id}`),
          apiFetch(`/api/campaigns/${id}/progress`),
        ]);
        if (!active) return;
        setCampaign(campaignData);
        setProgress(progressData);
      } catch (error) {
        console.error(error);
      } finally {
        if (!active) return;
        if (initialLoad) setLoading(false);
        if (!initialLoad) setRefreshingProgress(false);
      }
    }

    loadAll(true);
    const timer = window.setInterval(() => loadAll(false), 4000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id]);

  async function toggleStatus() {
    if (!campaign) return;

    const endpoint = campaign.status === 'running' ? `/api/campaigns/${id}/pause` : `/api/campaigns/${id}/start`;
    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });

    const [campaignData, progressData] = await Promise.all([
      apiFetch(`/api/campaigns/${id}`),
      apiFetch(`/api/campaigns/${id}/progress`),
    ]);
    setCampaign(campaignData);
    setProgress(progressData);
  }

  const overallProgress = useMemo(() => {
    if (!progress) return 0;
    return Math.max(0, Math.min(100, Number(progress.overall_progress_pct || 0)));
  }, [progress]);

  const searchProgress = useMemo(() => {
    if (!progress) return 0;
    return Math.max(0, Math.min(100, Number(progress.search_progress_pct || 0)));
  }, [progress]);

  if (loading) {
    return <div className="card animate-pulse p-6 text-sm text-[#9BA7B4]">Carregando campanha...</div>;
  }

  if (!campaign) {
    return <div className="card p-6 text-sm text-[#9BA7B4]">Campanha nao encontrada.</div>;
  }

  return (
    <div className="space-y-5 overflow-y-auto px-6 pb-8 pt-6 md:px-8">
      <Link
        href="/dashboard/campaigns"
        className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.1em] text-[#9BA7B4] transition-colors hover:text-[#E6EDF3]"
      >
        <ArrowLeft className="h-4 w-4" />
        VOLTAR PARA CAMPANHAS
      </Link>

      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">CAMPAIGN DETAILS</p>
            <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">{campaign.name}</h1>
            <p className="mt-1 text-sm text-[#9BA7B4]">
              {campaign.niche} | {campaign.city} (+{campaign.radius_km}km)
            </p>
          </div>

          <button
            onClick={toggleStatus}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
              campaign.status === 'running'
                ? 'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] text-[#F59E0B] hover:bg-[rgba(245,158,11,0.24)]'
                : 'border-[rgba(34,197,94,0.5)] bg-[rgba(34,197,94,0.16)] text-[#22C55E] hover:bg-[rgba(34,197,94,0.24)]'
            }`}
          >
            {campaign.status === 'running' ? (
              <>
                <Pause className="h-4 w-4" />
                Pausar
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Iniciar
              </>
            )}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            ['Status', campaign.status],
            ['Limite diario', `${campaign.daily_limit} envios`],
            ['Auto envio', campaign.auto_send ? 'Ativo' : 'Manual'],
            ['Canais', campaign.channels.join(', ')],
            ['Min avaliacoes Google', `${campaign.min_google_reviews}`],
            ['Max empresas na campanha', `${campaign.max_companies}`],
            ['Nota minima IA (stakeholders)', `${campaign.min_ai_score_for_stakeholders}`],
            ['Criada em', new Date(campaign.created_at).toLocaleDateString('pt-BR')],
          ].map(([label, value]) => (
            <div key={label} className="surface-soft px-3.5 py-3">
              <p className="text-xs font-semibold tracking-[0.08em] text-[#5C6673]">{label}</p>
              <p className="mt-1 text-sm font-semibold text-[#E6EDF3]">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">CAMPAIGN MONITORING</p>
            <h2 className="mt-1 text-lg font-semibold text-[#E6EDF3]">Progresso e buscas</h2>
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-[#9BA7B4]">
            <Activity className={`h-3.5 w-3.5 ${refreshingProgress ? 'animate-pulse' : ''}`} />
            Atualizacao automatica a cada 4s
          </div>
        </div>

        {!progress ? (
          <p className="text-sm text-[#9BA7B4]">Carregando monitoramento...</p>
        ) : (
          <div className="space-y-4">
            <article className="surface-soft px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#E6EDF3]">Progresso geral da campanha</p>
                <span className="text-xs font-semibold text-[#2ED1C8]">{overallProgress.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1F2937]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)] transition-all"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[#9BA7B4]">
                {progress.companies_in_campaign} de {progress.target_max_companies} empresas na campanha
              </p>
            </article>

            <article className="surface-soft px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#E6EDF3]">Progresso da busca atual</p>
                <span className="text-xs font-semibold text-[#2ED1C8]">{searchProgress.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1F2937]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(135deg,#1AA7A1_0%,#2ED1C8_100%)] transition-all"
                  style={{ width: `${searchProgress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[#9BA7B4]">
                {progress.search.processed} processadas de {progress.search.total_found} encontradas
              </p>
            </article>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['Salvas na busca', progress.search.saved],
                ['Filtradas por avaliacao', progress.search.skipped_low_reviews],
                ['Duplicadas', progress.search.skipped_duplicate],
                ['Ignoradas por tipo', progress.search.skipped_type],
                ['Erros', progress.search.errors],
                ['Com IA analisada', progress.analyzed_companies],
                ['Stakeholders encontrados', progress.stakeholders_found],
                ['Mensagens geradas', progress.messages_generated],
              ].map(([label, value]) => (
                <div key={label} className="surface-soft px-3 py-2.5">
                  <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-[#5C6673]">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-[#E6EDF3]">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#9BA7B4]">
              <p>Ultima busca iniciada: {formatDateTime(progress.search.last_started_at)}</p>
              <p>Ultima busca finalizada: {formatDateTime(progress.search.last_finished_at)}</p>
            </div>
          </div>
        )}
      </section>

      <section className="card border-[rgba(26,167,161,0.36)] bg-[linear-gradient(135deg,rgba(58,47,107,0.2)_0%,rgba(26,167,161,0.16)_100%)]">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(26,167,161,0.45)] bg-[rgba(20,128,124,0.2)]">
            <Radar className="h-5 w-5 text-[#2ED1C8]" />
          </div>
          <p className="text-sm text-[#9BA7B4]">
            Agora o monitoramento mostra filtros de qualidade, limite maximo de empresas e andamento da busca em tempo real.
          </p>
        </div>
      </section>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}
