'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Building2, Search, ChevronRight, ArrowUpDown } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  niche: string | null;
  city: string | null;
  ai_score: number | null;
  pipeline_stage: string;
  enrichment_status: string;
  google_rating: number | null;
  phone: string | null;
  created_at: string;
}

type SortField =
  | 'name'
  | 'ai_score'
  | 'google_rating'
  | 'pipeline_stage'
  | 'enrichment_status'
  | 'created_at';
type SortDirection = 'asc' | 'desc';

const STAGE_BADGE: Record<string, string> = {
  prospected: 'bg-gray-500/20 text-gray-400',
  enriched: 'bg-blue-500/20 text-blue-400',
  analyzed: 'bg-purple-500/20 text-purple-400',
  approved: 'bg-brand/20 text-brand',
  contacted: 'bg-yellow-500/20 text-yellow-400',
  replied: 'bg-green-500/20 text-green-400',
  meeting: 'bg-teal-500/20 text-teal-400',
  lost: 'bg-red-500/20 text-red-400',
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
    apiFetch('/api/companies?limit=200')
      .then((d) => setCompanies(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = companies.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.niche || '').toLowerCase().includes(q) ||
      (c.city || '').toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let result = 0;
    switch (sortField) {
      case 'name':
        result = a.name.localeCompare(b.name, 'pt-BR');
        break;
      case 'ai_score':
        result = compareNullableNumbers(a.ai_score, b.ai_score);
        break;
      case 'google_rating':
        result = compareNullableNumbers(a.google_rating, b.google_rating);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Empresas</h1>
          <p className="text-gray-400 mt-1">{companies.length} empresas no pipeline</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nome, nicho ou cidade..."
            className="input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-500" />
          <select
            className="input min-w-48"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
          >
            <option value="created_at">Data de criacao</option>
            <option value="ai_score">Score IA</option>
            <option value="name">Nome</option>
            <option value="google_rating">Avaliacao Google</option>
            <option value="pipeline_stage">Estagio</option>
            <option value="enrichment_status">Status de enriquecimento</option>
          </select>
        </div>

        <select
          className="input min-w-36"
          value={sortDirection}
          onChange={(e) => setSortDirection(e.target.value as SortDirection)}
        >
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-gray-400 text-xs">
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Nicho / Cidade</th>
                <th className="px-4 py-3 font-medium">Score IA</th>
                <th className="px-4 py-3 font-medium">Estagio</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {[...Array(6)].map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-3 bg-surface-border rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : sorted.map((company) => (
                    <tr key={company.id} className="hover:bg-surface-hover transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-brand/20 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-brand" />
                          </div>
                          <div>
                            <p className="font-medium text-white truncate max-w-40">{company.name}</p>
                            {company.phone && <p className="text-xs text-gray-500">{company.phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <p>{company.niche || '-'}</p>
                        <p className="text-xs text-gray-600">{company.city || '-'}</p>
                      </td>
                      <td className="px-4 py-3">
                        {company.ai_score !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-surface-border rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{ width: `${company.ai_score}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-brand">{company.ai_score}</span>
                          </div>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${
                            STAGE_BADGE[company.pipeline_stage] || 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {company.pipeline_stage}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${
                            company.enrichment_status === 'done'
                              ? 'bg-green-500/20 text-green-400'
                              : company.enrichment_status === 'processing'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : company.enrichment_status === 'failed'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {company.enrichment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/companies/${company.id}`}>
                          <ChevronRight className="w-4 h-4 text-gray-500 hover:text-white transition-colors" />
                        </Link>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
