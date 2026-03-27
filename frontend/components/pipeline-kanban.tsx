'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

const STAGES = [
  { key: 'prospected', label: 'Prospectado', edge: '#5C6673' },
  { key: 'enriched', label: 'Enriquecido', edge: '#38BDF8' },
  { key: 'analyzed', label: 'Analisado', edge: '#5A4FB2' },
  { key: 'approved', label: 'Aprovado', edge: '#1AA7A1' },
  { key: 'contacted', label: 'Contactado', edge: '#F59E0B' },
  { key: 'replied', label: 'Respondeu', edge: '#22C55E' },
  { key: 'meeting', label: 'Reuniao', edge: '#2ED1C8' },
  { key: 'lost', label: 'Perdido', edge: '#EF4444' },
];

interface Company {
  id: string;
  name: string;
  niche: string | null;
  ai_score: number | null;
  pipeline_stage: string;
  city: string | null;
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
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((s) => (
          <div key={s.key} className="h-52 w-[260px] flex-shrink-0 rounded-2xl border border-[#1F2937] bg-[rgba(18,24,33,0.72)] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map((stage) => {
        const stageCompanies = companies.filter((c) => c.pipeline_stage === stage.key);

        return (
          <div
            key={stage.key}
            className="w-[260px] flex-shrink-0 overflow-hidden rounded-2xl border border-[#1F2937] bg-[linear-gradient(180deg,rgba(26,35,48,0.84)_0%,rgba(18,24,33,0.93)_100%)]"
            style={{ boxShadow: `inset 0 2px 0 ${stage.edge}` }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage.key)}
          >
            <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
              <span className="text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">{stage.label}</span>
              <span className="badge badge-neutral">{stageCompanies.length}</span>
            </div>

            <div className="max-h-[440px] min-h-[180px] space-y-2 overflow-y-auto p-2.5">
              {stageCompanies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#1F2937] px-3 py-7 text-center text-xs tracking-[0.06em] text-[#5C6673]">
                  SEM ITENS
                </div>
              ) : (
                stageCompanies.map((company) => (
                  <article
                    key={company.id}
                    draggable
                    onDragStart={() => setDragging(company)}
                    onDragEnd={() => setDragging(null)}
                    className="group rounded-xl border border-[#1F2937] bg-[rgba(18,24,33,0.86)] p-3 transition-colors hover:border-[rgba(26,167,161,0.48)]"
                  >
                    <p className="truncate text-sm font-semibold text-[#E6EDF3]">{company.name}</p>
                    <p className="mt-1 truncate text-xs text-[#9BA7B4]">{company.niche || company.city || 'Sem classificacao'}</p>

                    {company.ai_score !== null && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1F2937]">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)]"
                            style={{ width: `${Math.max(4, company.ai_score)}%` }}
                          />
                        </div>
                        <span className="text-[0.72rem] font-semibold text-[#2ED1C8]">{company.ai_score}</span>
                      </div>
                    )}

                    <Link
                      href={`/dashboard/companies/${company.id}`}
                      className="mt-3 inline-flex items-center gap-1 text-[0.72rem] font-semibold tracking-[0.06em] text-[#5C6673] transition-colors hover:text-[#E6EDF3]"
                    >
                      DETALHES <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </article>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}