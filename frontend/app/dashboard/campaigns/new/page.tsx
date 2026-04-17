'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Plus, Play, Pause, ChevronRight, Megaphone, Radar } from 'lucide-react';
import { CampaignWizard } from '@/components/campaign-wizard';
import { BrandLogo } from '@/components/brand-logo';
import GoogleMapComponent from '@/components/maps';

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
      {/* <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">CAMPAIGN CONTROL</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">Campanhas Nova</h1>
          <p className="mt-1 text-sm text-[#9BA7B4]">{campaigns.length.toLocaleString('pt-BR')} fluxos ativos ou em preparacao</p>
        </div>

        <button onClick={() => setShowWizard(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nova campanha
        </button>
      </header> */}

      <GoogleMapComponent />
    </div>
  );
}
