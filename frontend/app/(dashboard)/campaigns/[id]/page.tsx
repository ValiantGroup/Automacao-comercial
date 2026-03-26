'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, Play, Pause } from 'lucide-react';
import Link from 'next/link';

interface Campaign {
  id: string; name: string; niche: string; city: string; radius_km: number;
  status: string; daily_limit: number; auto_send: boolean; ai_prompt_context: string;
  channels: string[]; created_at: string;
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

  async function toggle() {
    if (!campaign) return;
    const endpoint = campaign.status === 'running'
      ? `/api/campaigns/${id}/pause`
      : `/api/campaigns/${id}/start`;
    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
    setCampaign((prev) => prev ? { ...prev, status: prev.status === 'running' ? 'paused' : 'running' } : prev);
  }

  if (loading) return <div className="animate-pulse p-6 text-gray-400">Carregando...</div>;
  if (!campaign) return <div className="p-6 text-gray-400">Campanha não encontrada.</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/dashboard/campaigns" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
            <p className="text-gray-400 mt-1">{campaign.niche} — {campaign.city} (+{campaign.radius_km}km)</p>
          </div>
          <button onClick={toggle} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${campaign.status === 'running' ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border border-yellow-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'}`}>
            {campaign.status === 'running' ? <><Pause className="w-4 h-4" />Pausar</> : <><Play className="w-4 h-4" />Iniciar</>}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          {[
            ['Status', campaign.status],
            ['Limite diário', `${campaign.daily_limit} envios`],
            ['Auto-envio', campaign.auto_send ? 'Sim' : 'Não'],
            ['Criada em', new Date(campaign.created_at).toLocaleDateString('pt-BR')],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface rounded-lg p-3 border border-surface-border">
              <p className="text-xs text-gray-500">{k}</p>
              <p className="text-sm font-medium text-white mt-0.5">{v}</p>
            </div>
          ))}
        </div>

        {campaign.ai_prompt_context && (
          <div className="mt-4">
            <p className="text-sm text-gray-400 mb-1">Contexto da IA</p>
            <p className="text-sm text-gray-300 bg-surface rounded-lg p-3 border border-surface-border leading-relaxed">{campaign.ai_prompt_context}</p>
          </div>
        )}
      </div>
    </div>
  );
}
