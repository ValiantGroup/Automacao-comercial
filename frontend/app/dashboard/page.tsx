'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  MessageSquare,
  Send,
  TrendingUp,
  Radar,
  Workflow,
  CheckCheck,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PipelineKanban } from '@/components/pipeline-kanban';
import { BrandLogo } from '@/components/brand-logo';

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

interface StatCard {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  href?: string;
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

  const statCards = useMemo<StatCard[]>(() => {
    if (!stats) return [];
    return [
      {
        label: 'Empresas mapeadas',
        value: stats.total_companies.toLocaleString('pt-BR'),
        sub: `+${stats.companies_today} hoje`,
        icon: Building2,
        accent: 'info',
      },
      {
        label: 'Pendencias de aprovacao',
        value: stats.pending_review.toLocaleString('pt-BR'),
        sub: 'Aguardando validacao comercial',
        icon: MessageSquare,
        accent: 'warning',
        href: '/dashboard/outreach',
      },
      {
        label: 'Envios no dia',
        value: stats.sent_today.toLocaleString('pt-BR'),
        sub: `${stats.total_sent.toLocaleString('pt-BR')} no acumulado`,
        icon: Send,
        accent: 'success',
      },
      {
        label: 'Taxa de abertura',
        value: `${stats.email_open_rate_pct.toFixed(1)}%`,
        sub: `${stats.total_replied.toLocaleString('pt-BR')} respostas`,
        icon: TrendingUp,
        accent: 'brand',
      },
    ];
  }, [stats]);

  return (
    <div className="space-y-6 overflow-y-auto px-6 pb-8 pt-6 md:px-8">
      <section className="card relative overflow-hidden p-6 md:p-7">
        <div className="absolute -right-5 -top-5 w-32 opacity-[0.12] md:w-40">
          <BrandLogo mode="icon" muted />
        </div>
        <p className="text-xs font-semibold tracking-[0.18em] text-[#5C6673]">EXECUTIVE SNAPSHOT</p>
        <h2 className="mt-2 max-w-3xl text-2xl font-semibold leading-tight text-[#E6EDF3] md:text-[2rem]">
          Controle fino da operacao com fluxo comercial silencioso, inteligente e continuo.
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-[#9BA7B4]">
          Acompanhe ritmo de prospeccao, qualidade da mensagem e conversoes com sinais consolidados em tempo real.
        </p>
      </section>

      {loading ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="stat-card h-[126px] animate-pulse" />
          ))}
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => (
            <article key={card.label} className={`stat-card p-5 ${card.href ? 'cursor-pointer' : ''}`}>
              {card.href ? (
                <Link href={card.href} className="flex h-full flex-col">
                  <StatCardContent card={card} />
                </Link>
              ) : (
                <StatCardContent card={card} />
              )}
            </article>
          ))}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ActionCard
          href="/dashboard/campaigns"
          title="Orquestrar campanha"
          description="Criar nova onda de prospeccao com criterios precisos"
          icon={Radar}
          accent="brand"
        />
        <ActionCard
          href="/dashboard/outreach"
          title="Revisar mensagens"
          description={`${stats?.pending_review ?? 0} itens aguardando aprovacao final`}
          icon={CheckCheck}
          accent="warning"
        />
        <ActionCard
          href="/dashboard/companies"
          title="Acompanhar pipeline"
          description="Visualizar avancos, gargalos e prioridades das contas"
          icon={Workflow}
          accent="teal"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.15em] text-[#5C6673]">PIPELINE BOARD</p>
            <h3 className="text-xl font-semibold text-[#E6EDF3]">Pipeline de prospeccao</h3>
          </div>
        </div>
        <PipelineKanban />
      </section>
    </div>
  );
}

function StatCardContent({ card }: { card: StatCard }) {
  const Icon = card.icon;

  const accentMap: Record<StatCard['accent'], { iconWrap: string; iconColor: string; valueColor: string }> = {
    info: {
      iconWrap: 'bg-[rgba(56,189,248,0.18)] border-[rgba(56,189,248,0.35)]',
      iconColor: 'text-[#38BDF8]',
      valueColor: 'text-[#E6EDF3]',
    },
    warning: {
      iconWrap: 'bg-[rgba(245,158,11,0.18)] border-[rgba(245,158,11,0.35)]',
      iconColor: 'text-[#F59E0B]',
      valueColor: 'text-[#F59E0B]',
    },
    success: {
      iconWrap: 'bg-[rgba(34,197,94,0.18)] border-[rgba(34,197,94,0.35)]',
      iconColor: 'text-[#22C55E]',
      valueColor: 'text-[#22C55E]',
    },
    brand: {
      iconWrap: 'bg-[rgba(90,79,178,0.22)] border-[rgba(90,79,178,0.35)]',
      iconColor: 'text-[#2ED1C8]',
      valueColor: 'text-[#2ED1C8]',
    },
  };

  const accent = accentMap[card.accent] || accentMap.info;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[#9BA7B4]">{card.label}</p>
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${accent.iconWrap}`}>
          <Icon className={`h-4 w-4 ${accent.iconColor}`} />
        </div>
      </div>
      <p className={`mt-4 text-[1.95rem] font-semibold leading-none ${accent.valueColor}`}>{card.value}</p>
      <p className="mt-2 text-xs font-medium text-[#5C6673]">{card.sub}</p>
    </>
  );
}

function ActionCard({
  href,
  title,
  description,
  icon: Icon,
  accent,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'brand' | 'warning' | 'teal';
}) {
  const style = {
    brand: {
      wrap: 'bg-[rgba(90,79,178,0.2)] border-[rgba(90,79,178,0.38)]',
      icon: 'text-[#5A4FB2]',
      hover: 'group-hover:border-[rgba(90,79,178,0.55)]',
    },
    warning: {
      wrap: 'bg-[rgba(245,158,11,0.18)] border-[rgba(245,158,11,0.38)]',
      icon: 'text-[#F59E0B]',
      hover: 'group-hover:border-[rgba(245,158,11,0.6)]',
    },
    teal: {
      wrap: 'bg-[rgba(26,167,161,0.2)] border-[rgba(26,167,161,0.38)]',
      icon: 'text-[#2ED1C8]',
      hover: 'group-hover:border-[rgba(26,167,161,0.6)]',
    },
  }[accent];

  return (
    <Link
      href={href}
      className={`card group flex items-center justify-between gap-4 border-[#1F2937] transition-colors ${style.hover}`}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <div className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${style.wrap}`}>
          <Icon className={`h-5 w-5 ${style.icon}`} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#E6EDF3]">{title}</p>
          <p className="mt-1 text-xs text-[#9BA7B4]">{description}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#5C6673] transition-colors group-hover:text-[#E6EDF3]" />
    </Link>
  );
}