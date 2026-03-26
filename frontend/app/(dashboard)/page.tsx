'use client';

import { useEffect, useState } from 'react';
import {
  Building2, MessageSquare, Send, TrendingUp,
  BarChart3, Activity, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PipelineKanban } from '@/components/pipeline-kanban';

interface DashboardStats {
  total_companies: number;
  companies_today: number;
  pending_review: number;
  sent_today: number;
  total_sent: number;
  total_opened: number;
  total_replied: number;
  email_open_rate_pct: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/dashboard/stats')
      .then((data) => setStats(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statCards = stats
    ? [
        {
          label: 'Empresas Prospectadas',
          value: stats.total_companies.toLocaleString(),
          sub: `+${stats.companies_today} hoje`,
          icon: Building2,
          color: 'text-blue-400',
          bg: 'bg-blue-400/10',
        },
        {
          label: 'Aprovações Pendentes',
          value: stats.pending_review.toLocaleString(),
          sub: 'Aguardando revisão',
          icon: MessageSquare,
          color: 'text-amber-400',
          bg: 'bg-amber-400/10',
          href: '/dashboard/outreach',
        },
        {
          label: 'Enviadas Hoje',
          value: stats.sent_today.toLocaleString(),
          sub: `${stats.total_sent.toLocaleString()} no total`,
          icon: Send,
          color: 'text-green-400',
          bg: 'bg-green-400/10',
        },
        {
          label: 'Taxa de Abertura',
          value: `${stats.email_open_rate_pct.toFixed(1)}%`,
          sub: `${stats.total_replied} responderam`,
          icon: TrendingUp,
          color: 'text-brand',
          bg: 'bg-brand/10',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">Visão geral do sistema de prospecção</p>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="stat-card animate-pulse h-28 bg-surface-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div key={card.label} className={`stat-card ${card.href ? 'cursor-pointer hover:scale-[1.01] transition-transform' : ''}`}>
              {card.href ? (
                <Link href={card.href} className="contents">
                  <StatCardContent card={card} />
                </Link>
              ) : (
                <StatCardContent card={card} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link href="/dashboard/campaigns" className="card flex items-center justify-between hover:border-brand/40 transition-colors group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand/20 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-brand" />
            </div>
            <div>
              <p className="font-medium text-white">Nova Campanha</p>
              <p className="text-sm text-gray-400">Iniciar prospecção</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-brand transition-colors" />
        </Link>

        <Link href="/dashboard/outreach" className="card flex items-center justify-between hover:border-amber-500/40 transition-colors group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="font-medium text-white">Aprovar Mensagens</p>
              <p className="text-sm text-gray-400">{stats?.pending_review ?? '—'} pendentes</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-amber-400 transition-colors" />
        </Link>

        <Link href="/dashboard/companies" className="card flex items-center justify-between hover:border-green-500/40 transition-colors group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="font-medium text-white">Ver Empresas</p>
              <p className="text-sm text-gray-400">Pipeline completo</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-green-400 transition-colors" />
        </Link>
      </div>

      {/* Kanban pipeline */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Pipeline de Prospecção</h2>
        <PipelineKanban />
      </div>
    </div>
  );
}

function StatCardContent({ card }: { card: any }) {
  const Icon = card.icon;
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{card.label}</p>
        <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${card.color}`} />
        </div>
      </div>
      <p className="text-3xl font-bold text-white">{card.value}</p>
      <p className="text-xs text-gray-500">{card.sub}</p>
    </>
  );
}
