'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Play, Pause, Radar } from 'lucide-react';
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
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    apiFetch(`/api/campaigns/${id}`)
      .then(setCampaign)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleStatus() {
    if (!campaign) return;

    const endpoint = campaign.status === 'running'
      ? `/api/campaigns/${id}/pause`
      : `/api/campaigns/${id}/start`;

    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });

    setCampaign((prev) => {
      if (!prev) return prev;
      return { ...prev, status: prev.status === 'running' ? 'paused' : 'running' };
    });
  }

  if (loading) {
    return <div className="card animate-pulse p-6 text-sm text-[#9BA7B4]">Carregando campanha...</div>;
  }

  if (!campaign) {
    return <div className="card p-6 text-sm text-[#9BA7B4]">Campanha nao encontrada.</div>;
  }

  return (
    <div className="space-y-5">
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
            ['Criada em', new Date(campaign.created_at).toLocaleDateString('pt-BR')],
          ].map(([label, value]) => (
            <div key={label} className="surface-soft px-3.5 py-3">
              <p className="text-xs font-semibold tracking-[0.08em] text-[#5C6673]">{label}</p>
              <p className="mt-1 text-sm font-semibold text-[#E6EDF3]">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card border-[rgba(26,167,161,0.36)] bg-[linear-gradient(135deg,rgba(58,47,107,0.2)_0%,rgba(26,167,161,0.16)_100%)]">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(26,167,161,0.45)] bg-[rgba(20,128,124,0.2)]">
            <Radar className="h-5 w-5 text-[#2ED1C8]" />
          </div>
          <p className="text-sm text-[#9BA7B4]">
            Mantenha campanhas segmentadas por nicho para elevar consistencia de resposta e previsibilidade de funil.
          </p>
        </div>
      </section>
    </div>
  );
}