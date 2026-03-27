'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Credenciais invalidas');
        return;
      }

      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      router.replace('/dashboard');
    } catch {
      setError('Falha de conexao com o servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(90,79,178,0.24)_0%,rgba(11,15,20,0)_48%),radial-gradient(circle_at_86%_8%,rgba(46,209,200,0.2)_0%,rgba(11,15,20,0)_45%)]" />

      <div className="relative z-10 mx-auto grid w-full max-w-[1080px] gap-6 pt-6 lg:grid-cols-[1.08fr_0.92fr] lg:pt-14">
        <section className="card relative hidden overflow-hidden lg:block">
          <div className="w-[15.5rem]">
            <BrandLogo mode="full" priority />
          </div>
          <p className="mt-10 max-w-md text-[2rem] font-semibold leading-[1.18] text-[#E6EDF3]">
            Automacao comercial com assinatura visual, controle e precisao de nivel enterprise.
          </p>

          <div className="mt-10 space-y-3">
            {[
              'Pipeline unificado para prospeccao, aprovacao e outreach.',
              'Execucao com telemetria em tempo real e revisao contextual.',
              'Governanca operacional com diagnostico de integracoes.',
            ].map((item) => (
              <div
                key={item}
                className="surface-soft flex items-start gap-3 px-3.5 py-3 text-sm text-[#9BA7B4]"
              >
                <span className="mt-[0.35rem] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2ED1C8]" />
                {item}
              </div>
            ))}
          </div>

          <div className="logo-watermark w-16">
            <BrandLogo mode="icon" muted />
          </div>
        </section>

        <section className="card relative mx-auto w-full max-w-[460px] overflow-hidden animate-fade-in">
          <div className="absolute right-4 top-4 w-10 opacity-15">
            <BrandLogo mode="icon" />
          </div>

          <div className="mx-auto mb-8 w-[11.6rem] lg:hidden">
            <BrandLogo mode="full" priority />
          </div>

          <p className="text-xs font-semibold tracking-[0.18em] text-[#5C6673]">VALIANT ACCESS</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold text-[#E6EDF3]">Entrar na operacao</h1>
          <p className="mt-1 text-sm text-[#9BA7B4]">Ambiente protegido para equipes comerciais de alta performance.</p>

          <form onSubmit={handleLogin} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">E-MAIL</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6673]" />
                <input
                  type="email"
                  className="input pl-10"
                  placeholder="voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">SENHA</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6673]" />
                <input
                  type="password"
                  className="input pl-10"
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </label>

            {error && (
              <div className="rounded-xl border border-[rgba(239,68,68,0.48)] bg-[rgba(239,68,68,0.14)] px-3 py-2.5 text-sm text-[#EF4444]">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary mt-2 inline-flex w-full items-center justify-center gap-2 py-2.5" disabled={loading}>
              {loading ? 'Autenticando...' : 'Acessar plataforma'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-2 rounded-xl border border-[#1F2937] bg-[rgba(18,24,33,0.72)] px-3 py-2.5 text-xs text-[#9BA7B4]">
            <ShieldCheck className="h-4 w-4 text-[#1AA7A1]" />
            Sessao criptografada e gerenciamento seguro de credenciais.
          </div>
        </section>
      </div>
    </div>
  );
}
