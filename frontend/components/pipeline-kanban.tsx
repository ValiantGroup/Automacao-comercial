'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ChevronRight } from 'lucide-react';

const STAGES = [
  { key: 'prospected', label: 'Prospectado', color: 'border-gray-500' },
  { key: 'enriched', label: 'Enriquecido', color: 'border-blue-500' },
  { key: 'analyzed', label: 'Analisado', color: 'border-purple-500' },
  { key: 'approved', label: 'Aprovado', color: 'border-brand' },
  { key: 'contacted', label: 'Contactado', color: 'border-yellow-500' },
  { key: 'replied', label: 'Respondeu', color: 'border-green-500' },
  { key: 'meeting', label: 'Reunião', color: 'border-teal-500' },
  { key: 'lost', label: 'Perdido', color: 'border-red-500' },
];

interface Company {
  id: string;
  name: string;
  niche: string | null;
  ai_score: number | null;
  pipeline_stage: string;
  city: string | null;
  enrichment_status: string;
}

export function PipelineKanban() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<Company | null>(null);

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    try {
      const data = await apiFetch('/api/companies?limit=200');
      setCompanies(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDrop(stage: string) {
    if (!dragging || dragging.pipeline_stage === stage) return;
    try {
      await apiFetch(`/api/companies/${dragging.id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      });
      setCompanies((prev) =>
        prev.map((c) => (c.id === dragging.id ? { ...c, pipeline_stage: stage } : c)),
      );
      setDragging(null);
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => (
          <div key={s.key} className="flex-shrink-0 w-52 h-40 bg-surface-card rounded-xl animate-pulse border border-surface-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STAGES.map((stage) => {
        const stageCompanies = companies.filter((c) => c.pipeline_stage === stage.key);
        return (
          <div
            key={stage.key}
            className={`flex-shrink-0 w-52 bg-surface-card rounded-xl border-t-2 ${stage.color} border-x border-b border-surface-border`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage.key)}
          >
            {/* Header */}
            <div className="px-3 py-2.5 border-b border-surface-border flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">{stage.label}</span>
              <span className="text-xs bg-surface-border text-gray-400 px-1.5 py-0.5 rounded-full">
                {stageCompanies.length}
              </span>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 min-h-24 max-h-96 overflow-y-auto">
              {stageCompanies.map((company) => (
                <div
                  key={company.id}
                  draggable
                  onDragStart={() => setDragging(company)}
                  onDragEnd={() => setDragging(null)}
                  className="bg-surface p-2.5 rounded-lg border border-surface-border hover:border-brand/40 cursor-grab active:cursor-grabbing transition-colors group"
                >
                  <p className="text-xs font-medium text-white truncate">{company.name}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{company.niche || company.city || '—'}</p>
                  {company.ai_score !== null && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <div className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand rounded-full transition-all"
                          style={{ width: `${company.ai_score}%` }}
                        />
                      </div>
                      <span className="text-xs text-brand font-medium">{company.ai_score}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
