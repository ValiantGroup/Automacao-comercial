'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Plus, Play, Pause, ChevronRight, Megaphone } from 'lucide-react';
import { CampaignWizard } from '@/components/campaign-wizard';

interface Campaign {
  id: string;
  name: string;
  niche: string;
  city: string;
  status: string;
  daily_limit: number;
  auto_send: boolean;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  running: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  finished: 'bg-blue-500/20 text-blue-400',
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
    const newStatus = campaign.status === 'running' ? 'paused' : 'started';
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Campanhas</h1>
          <p className="text-gray-400 mt-1">{campaigns.length} campanhas criadas</p>
        </div>
        <button onClick={() => setShowWizard(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Campanha
        </button>
      </div>

      {/* Campaigns list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-20 animate-pulse" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center py-12">
          <Megaphone className="w-12 h-12 text-brand mx-auto mb-3 opacity-40" />
          <p className="text-white font-medium">Nenhuma campanha criada</p>
          <p className="text-sm text-gray-500 mt-1">Crie uma campanha para começar a prospectar</p>
          <button onClick={() => setShowWizard(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Criar primeira campanha
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="card flex items-center justify-between hover:border-brand/30 transition-colors">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-brand/20 flex items-center justify-center flex-shrink-0">
                  <Megaphone className="w-5 h-5 text-brand" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{c.name}</p>
                  <p className="text-sm text-gray-400 truncate">{c.niche} • {c.city} • {c.daily_limit}/dia</p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`badge ${STATUS_BADGE[c.status] || 'bg-gray-500/20 text-gray-400'}`}>
                  {c.status}
                </span>
                {c.auto_send && <span className="badge bg-brand/20 text-brand">auto</span>}
                <button
                  onClick={() => toggleStatus(c)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    c.status === 'running'
                      ? 'text-yellow-400 hover:bg-yellow-500/10'
                      : 'text-green-400 hover:bg-green-500/10'
                  }`}
                  title={c.status === 'running' ? 'Pausar' : 'Iniciar'}
                >
                  {c.status === 'running' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <Link href={`/dashboard/campaigns/${c.id}`}>
                  <ChevronRight className="w-4 h-4 text-gray-500 hover:text-white transition-colors" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <CampaignWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { setShowWizard(false); loadCampaigns(); }}
        />
      )}
    </div>
  );
}
