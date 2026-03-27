'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Building2, Search, ChevronRight, ArrowUpDown } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

interface Company {
  id: string;
  name: string;
  niche: string | null;
  city: string | null;
  ai_score: number | null;
  pipeline_stage: string;
  enrichment_status: string;
  phone: string | null;
  created_at: string;
}

type SortField =
  | 'name'
  | 'ai_score'
  | 'pipeline_stage'
  | 'enrichment_status'
  | 'created_at';
type SortDirection = 'asc' | 'desc';

const STAGE_BADGE: Record<string, string> = {
  prospected: 'badge-neutral',
  enriched: 'badge-info',
  analyzed: 'badge-primary',
  approved: 'badge-teal',
  contacted: 'badge-warning',
  replied: 'badge-success',
  meeting: 'badge-teal',
  lost: 'badge-danger',
};

const ENRICH_BADGE: Record<string, string> = {
  done: 'badge-success',
  processing: 'badge-warning',
  failed: 'badge-danger',
};

function compareNullableNumbers(a: number | null, b: number | null): number {
  const va = a ?? -1;
  const vb = b ?? -1;
  return va - vb;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    apiFetch('/api/companies?limit=250')
      .then((d) => setCompanies(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.niche || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q)
      );
    });
  }, [companies, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let result = 0;

      switch (sortField) {
        case 'name':
          result = a.name.localeCompare(b.name, 'pt-BR');
          break;
        case 'ai_score':
          result = compareNullableNumbers(a.ai_score, b.ai_score);
          break;
        case 'pipeline_stage':
          result = a.pipeline_stage.localeCompare(b.pipeline_stage, 'pt-BR');
          break;
        case 'enrichment_status':
          result = a.enrichment_status.localeCompare(b.enrichment_status, 'pt-BR');
          break;
        case 'created_at':
        default:
          result = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }

      return sortDirection === 'asc' ? result : result * -1;
    });
  }, [filtered, sortField, sortDirection]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">ACCOUNT INTELLIGENCE</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">Empresas</h1>
          <p className="mt-1 text-sm text-[#9BA7B4]">{companies.length.toLocaleString('pt-BR')} contas no pipeline ativo</p>
        </div>
      </header>

      <section className="card grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6673]" />
          <input
            type="text"
            placeholder="Buscar por nome, nicho ou cidade..."
            className="input pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-[#5C6673]" />
          <select className="input min-w-[180px]" value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
            <option value="created_at">Data de criacao</option>
            <option value="ai_score">Score IA</option>
            <option value="name">Nome</option>
            <option value="pipeline_stage">Estagio</option>
            <option value="enrichment_status">Enriquecimento</option>
          </select>
        </div>

        <select
          className="input min-w-[150px]"
          value={sortDirection}
          onChange={(e) => setSortDirection(e.target.value as SortDirection)}
        >
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
      </section>

      <section className="table-shell">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead>
              <tr className="border-b border-[#1F2937] bg-[rgba(18,24,33,0.78)] text-left text-xs font-semibold tracking-[0.08em] text-[#5C6673]">
                <th className="px-4 py-3.5">EMPRESA</th>
                <th className="px-4 py-3.5">NICHO / CIDADE</th>
                <th className="px-4 py-3.5">SCORE IA</th>
                <th className="px-4 py-3.5">ESTAGIO</th>
                <th className="px-4 py-3.5">ENRIQUECIMENTO</th>
                <th className="px-4 py-3.5 text-right">ACAO</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#1F2937]">
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i} className="table-row animate-pulse">
                      {[...Array(6)].map((__, j) => (
                        <td key={j} className="px-4 py-4">
                          <div className="h-3 rounded bg-[#1F2937]" />
                        </td>
                      ))}
                    </tr>
                  ))
                : sorted.map((company) => (
                    <tr key={company.id} className="table-row">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(90,79,178,0.4)] bg-[rgba(58,47,107,0.25)]">
                            <Building2 className="h-4 w-4 text-[#5A4FB2]" />
                          </div>
                          <div>
                            <p className="font-semibold text-[#E6EDF3]">{company.name}</p>
                            {company.phone && <p className="text-xs text-[#5C6673]">{company.phone}</p>}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-sm text-[#9BA7B4]">{company.niche || '-'}</p>
                        <p className="text-xs text-[#5C6673]">{company.city || '-'}</p>
                      </td>

                      <td className="px-4 py-4">
                        {company.ai_score !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#1F2937]">
                              <div
                                className="h-full rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)]"
                                style={{ width: `${company.ai_score}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-[#2ED1C8]">{company.ai_score}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[#5C6673]">Sem score</span>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <span className={`badge ${STAGE_BADGE[company.pipeline_stage] || 'badge-neutral'}`}>
                          {company.pipeline_stage}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span className={`badge ${ENRICH_BADGE[company.enrichment_status] || 'badge-neutral'}`}>
                          {company.enrichment_status}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-right">
                        <Link
                          href={`/dashboard/companies/${company.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-[#5C6673] transition-colors hover:text-[#E6EDF3]"
                        >
                          ABRIR
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!loading && sorted.length === 0 && (
          <div className="relative border-t border-[#1F2937] px-6 py-14 text-center">
            <div className="mx-auto mb-4 w-16 opacity-50">
              <BrandLogo mode="icon" muted />
            </div>
            <p className="text-sm font-semibold text-[#E6EDF3]">Nenhum resultado para esta busca</p>
            <p className="mt-1 text-xs text-[#9BA7B4]">Ajuste os filtros para recuperar empresas no pipeline.</p>
          </div>
        )}
      </section>
    </div>
  );
}