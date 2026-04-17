'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Activity, ExternalLink, RefreshCw, Save } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

interface SettingsResponse {
  ai_global_context: string;
}

interface IntegrationDiagnostic {
  key: string;
  label: string;
  status: string;
  detail: string;
  checked_at: string;
}

interface DiagnosticsResponse {
  integrations: IntegrationDiagnostic[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'Operacional',
  missing_config: 'Nao configurado',
  unreachable: 'Indisponivel',
  auth_error: 'Credencial invalida',
  restricted: 'Restrito',
  degraded: 'Degradado',
};

const STATUS_CLASS: Record<string, string> = {
  ok: 'text-[#22C55E]',
  missing_config: 'text-[#9BA7B4]',
  unreachable: 'text-[#EF4444]',
  auth_error: 'text-[#EF4444]',
  restricted: 'text-[#F59E0B]',
  degraded: 'text-[#F59E0B]',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

function statusClass(status: string): string {
  return STATUS_CLASS[status] || 'text-[#9BA7B4]';
}

export default function SettingsPage() {
  const [aiGlobalContext, setAIGlobalContext] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError('');

    try {
      const settings = (await apiFetch('/api/settings')) as SettingsResponse;
      setAIGlobalContext(settings.ai_global_context || '');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar configuracoes';
      setError(msg);
    }

    try {
      const diagnostics = (await apiFetch('/api/settings/diagnostics')) as DiagnosticsResponse;
      setIntegrations(diagnostics.integrations || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar diagnostico';
      setError((prev) => (prev ? `${prev} | ${msg}` : msg));
    }

    setLoading(false);
  }

  async function saveContext() {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const data = (await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ai_global_context: aiGlobalContext }),
      })) as SettingsResponse;
      setAIGlobalContext(data.ai_global_context || '');
      setSuccess('Contexto global atualizado.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function refreshDiagnostics() {
    setChecking(true);
    setError('');

    try {
      const diagnostics = (await apiFetch('/api/settings/diagnostics')) as DiagnosticsResponse;
      setIntegrations(diagnostics.integrations || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao atualizar diagnostico';
      setError(msg);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-5 overflow-y-auto px-6 pb-8 pt-6 md:px-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">SYSTEM GOVERNANCE</p>
        <h1 className="mt-1 text-2xl font-semibold text-[#E6EDF3]">Configuracoes</h1>
        <p className="mt-1 text-sm text-[#9BA7B4]">Contexto global da IA e monitoramento de integracoes criticas.</p>
      </header>

      <section className="card relative overflow-hidden">
        <div className="logo-watermark w-14">
          <BrandLogo mode="icon" muted />
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3]">Contexto global da IA</h2>
            <p className="text-sm text-[#9BA7B4]">Base aplicada em todas as campanhas no backend.</p>
          </div>
          <button
            onClick={saveContext}
            disabled={saving || !aiGlobalContext.trim()}
            className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        <textarea
          value={aiGlobalContext}
          onChange={(e) => setAIGlobalContext(e.target.value)}
          rows={8}
          className="input min-h-[190px]"
          placeholder="Descreva posicionamento, oferta, tom e guardrails globais da operacao Valiant."
        />
      </section>

      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3]">Integracoes</h2>
            <p className="text-sm text-[#9BA7B4]">Estado de conectividade e autenticacao dos provedores.</p>
          </div>
          <button
            onClick={refreshDiagnostics}
            disabled={checking}
            className="btn-outline inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            {checking ? 'Verificando...' : 'Atualizar diagnostico'}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#9BA7B4]">Carregando integracoes...</p>
        ) : (
          <div className="space-y-2">
            {integrations.map((item) => (
              <article key={item.key} className="surface-soft px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#E6EDF3]">{item.label}</span>
                  <span className={`text-xs font-semibold tracking-[0.08em] ${statusClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#9BA7B4]">{item.detail || 'Sem detalhes adicionais'}</p>
                {item.checked_at && (
                  <p className="mt-1 text-[0.68rem] tracking-[0.08em] text-[#5C6673]">
                    ULTIMA VERIFICACAO: {new Date(item.checked_at).toLocaleString('pt-BR')}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {(error || success) && (
        <section
          className={`card text-sm ${error ? 'border-[rgba(239,68,68,0.46)] text-[#EF4444]' : 'border-[rgba(34,197,94,0.46)] text-[#22C55E]'}`}
        >
          {error || success}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <InstitutionCard
          title="Filas de processamento"
          description="Monitore workers, retries e throughput de jobs assincronos via Asynqmon."
          href="http://localhost:8082"
        />
        <InstitutionCard
          title="MinIO storage"
          description="Acesse artefatos, payloads e anexos operacionais no console de storage."
          href="http://localhost:9001"
        />
      </section>

      <section className="card border-[rgba(26,167,161,0.34)] bg-[linear-gradient(135deg,rgba(58,47,107,0.18)_0%,rgba(26,167,161,0.16)_100%)]">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(26,167,161,0.46)] bg-[rgba(20,128,124,0.2)]">
            <Activity className="h-5 w-5 text-[#2ED1C8]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#E6EDF3]">Centro institucional Valiant</p>
            <p className="mt-1 text-sm text-[#9BA7B4]">
              Este ambiente opera com diretrizes unificadas para consistencia de execucao, linguagem e performance comercial.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function InstitutionCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <article className="card">
      <p className="text-sm font-semibold text-[#E6EDF3]">{title}</p>
      <p className="mt-1 text-sm text-[#9BA7B4]">{description}</p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-outline mt-4 inline-flex items-center gap-1.5"
      >
        Abrir console
        <ExternalLink className="h-4 w-4" />
      </a>
    </article>
  );
}