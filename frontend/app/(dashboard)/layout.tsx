'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Building2, Megaphone,
  MessageSquare, Settings, LogOut, Zap,
} from 'lucide-react';
import { RealtimeFeed } from '@/components/realtime-feed';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/companies', label: 'Empresas', icon: Building2 },
  { href: '/dashboard/campaigns', label: 'Campanhas', icon: Megaphone },
  { href: '/dashboard/outreach', label: 'Aprovações', icon: MessageSquare },
  { href: '/dashboard/settings', label: 'Configurações', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      setUserName(user.name || user.email || '');
    } catch {}
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    router.push('/login');
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center">
              <Zap className="w-4 h-4 text-brand" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Valiant</p>
              <p className="text-xs text-gray-500">Prospector</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand/20 text-brand border border-brand/30'
                    : 'text-gray-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-surface-border">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-brand/30 flex items-center justify-center text-xs font-bold text-brand flex-shrink-0">
              {userName.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="text-sm text-gray-300 truncate flex-1">{userName || 'Usuário'}</span>
            <button onClick={handleLogout} className="text-gray-500 hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 animate-fade-in">
          {children}
        </div>
      </main>

      {/* Realtime feed (floating) */}
      <RealtimeFeed />
    </div>
  );
}
