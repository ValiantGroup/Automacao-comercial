'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  Megaphone,
  MessageSquare,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react';
import { RealtimeFeed } from '@/components/realtime-feed';
import { BrandLogo } from '@/components/brand-logo';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/companies', label: 'Empresas', icon: Building2 },
  { href: '/dashboard/campaigns', label: 'Campanhas', icon: Megaphone },
  { href: '/dashboard/outreach', label: 'Aprovacoes', icon: MessageSquare },
  { href: '/dashboard/settings', label: 'Configuracoes', icon: Settings },
];

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Operacao Comercial', subtitle: 'Visao consolidada da automacao e da receita em curso.' },
  '/dashboard/companies': { title: 'Pipeline de Empresas', subtitle: 'Controle de cada conta com prioridade, sinais e historico.' },
  '/dashboard/campaigns': { title: 'Maquina de Campanhas', subtitle: 'Orquestracao de execucao com metas e capacidade diaria.' },
  '/dashboard/outreach': { title: 'Centro de Aprovacoes', subtitle: 'Validacao final de mensagens com contexto e cadencia.' },
  '/dashboard/settings': { title: 'Governanca do Sistema', subtitle: 'Parametros globais e saude operacional das integracoes.' },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [booting, setBooting] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      setUserName(user.name || user.email || '');
    } catch {
      setUserName('');
    }

    const stored = localStorage.getItem('sidebar_collapsed');
    if (stored === '1') {
      setCollapsed(true);
    }

    const timer = window.setTimeout(() => setBooting(false), 560);
    return () => window.clearTimeout(timer);
  }, [router]);

  const currentPage = useMemo(() => {
    const ordered = Object.entries(pageMeta).sort((a, b) => b[0].length - a[0].length);
    const found = ordered.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
    return found?.[1] || pageMeta['/dashboard'];
  }, [pathname]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    router.replace('/login');
  }

  function handleToggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', next ? '1' : '0');
  }

  if (booting) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden px-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(46,209,200,0.16)_0%,rgba(11,15,20,0)_50%),radial-gradient(circle_at_15%_10%,rgba(90,79,178,0.22)_0%,rgba(11,15,20,0)_55%)]" />
        <div className="relative z-10 w-full max-w-sm rounded-[26px] border border-[#1F2937] bg-[linear-gradient(180deg,rgba(26,35,48,0.94)_0%,rgba(18,24,33,0.96)_100%)] p-7 shadow-[0_36px_72px_rgba(11,15,20,0.55)]">
          <div className="mx-auto w-[11.5rem] animate-float">
            <BrandLogo mode="full" priority />
          </div>
          <p className="mt-5 text-center text-sm font-semibold tracking-[0.18em] text-[#9BA7B4]">INITIALIZING OPS CORE</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#1F2937]">
            <div className="h-full w-2/3 rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)] animate-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_105%_-5%,rgba(46,209,200,0.09)_0%,rgba(11,15,20,0)_48%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_-10%_40%,rgba(90,79,178,0.1)_0%,rgba(11,15,20,0)_55%)]" />

      <aside
        className={`relative z-20 flex h-full flex-col border-r border-[#1F2937] bg-[linear-gradient(180deg,rgba(18,24,33,0.96)_0%,rgba(11,15,20,0.96)_100%)] transition-[width] duration-300 ${
          collapsed ? 'w-[88px]' : 'w-[280px]'
        }`}
      >
        <div className="border-b border-[#1F2937] px-4 py-4">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-3'}`}>
            <Link
              href="/dashboard"
              className={`group flex items-center rounded-2xl border border-[#1F2937] bg-[rgba(18,24,33,0.78)] transition-colors ${
                collapsed ? 'h-12 w-12 justify-center p-2.5' : 'px-3 py-2.5'
              }`}
              aria-label="Valiant"
            >
              {collapsed ? (
                <div className="w-full max-w-[2.1rem]">
                  <BrandLogo mode="icon" priority />
                </div>
              ) : (
                <div className="w-[7.8rem]">
                  <BrandLogo mode="full" priority />
                </div>
              )}
            </Link>

            {!collapsed && (
              <button
                onClick={handleToggleSidebar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#1F2937] bg-[rgba(26,35,48,0.62)] text-[#9BA7B4] transition-colors hover:border-[rgba(26,167,161,0.52)] hover:text-[#E6EDF3]"
                aria-label="Colapsar menu"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <button
              onClick={handleToggleSidebar}
              className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-xl border border-[#1F2937] bg-[rgba(26,35,48,0.62)] text-[#9BA7B4] transition-colors hover:border-[rgba(26,167,161,0.52)] hover:text-[#E6EDF3]"
              aria-label="Expandir menu"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-1.5 px-3 py-4">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`group flex items-center rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                  active
                    ? 'border-[rgba(26,167,161,0.62)] bg-[linear-gradient(135deg,rgba(58,47,107,0.42)_0%,rgba(26,167,161,0.26)_100%)] text-[#E6EDF3]'
                    : 'border-transparent text-[#9BA7B4] hover:border-[#1F2937] hover:bg-[rgba(26,35,48,0.72)] hover:text-[#E6EDF3]'
                } ${collapsed ? 'justify-center px-2.5' : 'gap-3'}`}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-[#2ED1C8]' : 'text-[#9BA7B4] group-hover:text-[#E6EDF3]'}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#1F2937] p-3">
          <div className={`rounded-2xl border border-[#1F2937] bg-[rgba(18,24,33,0.8)] p-2.5 ${collapsed ? 'space-y-2' : ''}`}>
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(58,47,107,0.6)_0%,rgba(26,167,161,0.7)_100%)] text-xs font-bold text-[#E6EDF3]">
                {userName.charAt(0).toUpperCase() || 'U'}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#E6EDF3]">{userName || 'Usuario'}</p>
                  <p className="text-xs tracking-[0.08em] text-[#5C6673]">CONTROL NODE</p>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              title={collapsed ? 'Sair' : undefined}
              className={`inline-flex w-full items-center justify-center rounded-xl border border-[#1F2937] bg-[rgba(26,35,48,0.62)] px-2.5 py-2 text-xs font-semibold text-[#9BA7B4] transition-colors hover:border-[rgba(239,68,68,0.4)] hover:text-[#EF4444] ${
                collapsed ? '' : 'gap-2'
              }`}
            >
              <LogOut className="h-3.5 w-3.5" />
              {!collapsed && 'Encerrar sessao'}
            </button>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass-topbar sticky top-0 z-30 px-6 py-4 md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-[#5C6673]">VALIANT ORCHESTRATOR</p>
              <h1 className="mt-1 text-[1.35rem] font-semibold text-[#E6EDF3]">{currentPage.title}</h1>
              <p className="mt-0.5 text-sm text-[#9BA7B4]">{currentPage.subtitle}</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden rounded-xl border border-[rgba(26,167,161,0.4)] bg-[rgba(20,128,124,0.15)] px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-[#2ED1C8] md:inline-flex md:items-center md:gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                PRECISION MODE
              </div>
              <div className="rounded-xl border border-[#1F2937] bg-[rgba(26,35,48,0.62)] px-3 py-1.5 text-xs font-medium text-[#9BA7B4]">
                {new Date().toLocaleDateString('pt-BR')}
              </div>
            </div>
          </div>
        </header>

        <main className="relative flex-1 overflow-y-auto px-6 pb-8 pt-6 md:px-8">{children}</main>
      </div>

      <RealtimeFeed />
    </div>
  );
}