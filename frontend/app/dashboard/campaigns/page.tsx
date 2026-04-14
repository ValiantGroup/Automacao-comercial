'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Plus, Play, Pause, ChevronRight, Megaphone, Radar } from 'lucide-react';
import { CampaignWizard } from '@/components/campaign-wizard';
import { BrandLogo } from '@/components/brand-logo';

interface Campaign {
  id: string;
  name: string;
  niche: string;
  city: string;
  status: string;
  daily_limit: number;
  auto_send: boolean;
  min_google_reviews: number;
  max_companies: number;
  min_ai_score_for_stakeholders: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-neutral',
  running: 'badge-success',
  paused: 'badge-warning',
  finished: 'badge-info',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    try {
      const data = await apiFetch('/api/campaigns');
      setCampaigns(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(campaign: Campaign) {
    const endpoint = campaign.status === 'running'
      ? `/api/campaigns/${campaign.id}/pause`
      : `/api/campaigns/${campaign.id}/start`;

    try {
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
      loadCampaigns();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">CAMPAIGN CONTROL</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">Campanhas</h1>
          <p className="mt-1 text-sm text-[#9BA7B4]">{campaigns.length.toLocaleString('pt-BR')} fluxos ativos ou em preparacao</p>
        </div>

        <button onClick={() => setShowWizard(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nova campanha
        </button>
      </header>

      {loading ? (
        <section className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card h-[106px] animate-pulse" />
          ))}
        </section>
      ) : campaigns.length === 0 ? (
        <section className="card relative overflow-hidden py-14 text-center">
          <div className="mx-auto mb-3 w-16 opacity-55">
            <BrandLogo mode="icon" muted />
          </div>
          <p className="text-lg font-semibold text-[#E6EDF3]">Nenhuma campanha criada</p>
          <p className="mt-1 text-sm text-[#9BA7B4]">Inicie a primeira campanha para ativar a maquina comercial.</p>
          <button onClick={() => setShowWizard(true)} className="btn-primary mt-5 inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Criar campanha
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          {campaigns.map((campaign) => (
            <article key={campaign.id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <div className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[rgba(58,47,107,0.5)] bg-[rgba(58,47,107,0.24)]">
                  <Megaphone className="h-5 w-5 text-[#5A4FB2]" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#E6EDF3]">{campaign.name}</p>
                  <p className="mt-1 truncate text-xs text-[#9BA7B4]">
                    {campaign.niche} | {campaign.city} | {campaign.daily_limit}/dia | max {campaign.max_companies}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_BADGE[campaign.status] || 'badge-neutral'}`}>{campaign.status}</span>
                {campaign.auto_send && <span className="badge badge-teal">auto</span>}
                <span className="badge badge-neutral">Google {campaign.min_google_reviews}+</span>
                <span className="badge badge-neutral">IA {campaign.min_ai_score_for_stakeholders}+</span>

                <button
                  onClick={() => toggleStatus(campaign)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                    campaign.status === 'running'
                      ? 'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] text-[#F59E0B] hover:bg-[rgba(245,158,11,0.24)]'
                      : 'border-[rgba(34,197,94,0.5)] bg-[rgba(34,197,94,0.16)] text-[#22C55E] hover:bg-[rgba(34,197,94,0.24)]'
                  }`}
                  title={campaign.status === 'running' ? 'Pausar' : 'Iniciar'}
                >
                  {campaign.status === 'running' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <Link
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="inline-flex items-center gap-1 rounded-xl border border-[#1F2937] bg-[rgba(18,24,33,0.65)] px-3 py-2 text-xs font-semibold tracking-[0.08em] text-[#9BA7B4] transition-colors hover:text-[#E6EDF3]"
                >
                  ABRIR
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="card border-[rgba(26,167,161,0.38)] bg-[linear-gradient(135deg,rgba(58,47,107,0.2)_0%,rgba(26,167,161,0.16)_100%)]">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(26,167,161,0.45)] bg-[rgba(20,128,124,0.2)]">
            <Radar className="h-5 w-5 text-[#2ED1C8]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#E6EDF3]">Ritmo recomendado</p>
            <p className="text-xs text-[#9BA7B4]">Distribua campanhas por nicho para manter volume estavel e qualidade de outreach.</p>
          </div>
        </div>
      </section>

      {showWizard && <CampaignWizard onClose={() => setShowWizard(false)} onCreated={() => { setShowWizard(false); loadCampaigns(); }} />}
    </div>
  );
}
