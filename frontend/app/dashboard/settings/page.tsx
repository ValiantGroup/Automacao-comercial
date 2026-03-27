'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface SettingsResponse {
  ai_global_context: string;
}

interface IntegrationDiagnostic {
  key: string;
  label: string;
  status: string;
  configured: boolean;
  reachable: boolean;
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
  auth_error: 'Erro de credencial',
  restricted: 'Restrito pelo plano',
  degraded: 'Degradado',
};

const STATUS_COLOR: Record<string, string> = {
  ok: 'text-green-400',
  missing_config: 'text-gray-400',
  unreachable: 'text-red-400',
  auth_error: 'text-orange-400',
  restricted: 'text-yellow-400',
  degraded: 'text-yellow-400',
};

function getStatusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

function getStatusColor(status: string): string {
  return STATUS_COLOR[status] || 'text-gray-400';
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
      setSuccess('Contexto global da IA atualizado com sucesso.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar contexto da IA';
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Configuracoes</h1>
        <p className="text-gray-400 mt-1">Contexto global da IA e diagnostico das integracoes</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-white">Contexto Global da IA</h2>
          <button
            onClick={saveContext}
            disabled={saving || !aiGlobalContext.trim()}
            className="btn-primary text-sm disabled:opacity-60"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        <p className="text-sm text-gray-400">
          Este contexto sera aplicado para todas as campanhas no backend.
        </p>
        <textarea
          value={aiGlobalContext}
          onChange={(e) => setAIGlobalContext(e.target.value)}
          rows={7}
          className="input min-h-[160px]"
          placeholder="Descreva aqui o posicionamento, oferta e regras globais de comunicacao da Valiant."
        />
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-white">Integracoes</h2>
          <button
            onClick={refreshDiagnostics}
            disabled={checking}
            className="btn-outline text-sm disabled:opacity-60"
          >
            {checking ? 'Verificando...' : 'Atualizar diagnostico'}
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Carregando...</div>
        ) : (
          integrations.map((item) => (
            <div key={item.key} className="py-2 border-b border-surface-border last:border-0 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-300">{item.label}</span>
                <span className={`text-xs font-medium ${getStatusColor(item.status)}`}>
                  {getStatusLabel(item.status)}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {item.detail || 'Sem detalhes'}
                {item.checked_at ? ` • ${new Date(item.checked_at).toLocaleString('pt-BR')}` : ''}
              </div>
            </div>
          ))
        )}
      </div>

      {(error || success) && (
        <div className={`card text-sm ${error ? 'text-red-400' : 'text-green-400'}`}>
          {error || success}
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-white mb-3">Filas de Processamento</h2>
        <p className="text-sm text-gray-400 mb-3">Monitore as filas em tempo real via Asynqmon:</p>
        <a
          href="http://localhost:8082"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline inline-flex items-center gap-2 text-sm"
        >
          Abrir Asynqmon -&gt;
        </a>
      </div>

      <div className="card">
        <h2 className="font-semibold text-white mb-3">MinIO Storage</h2>
        <a
          href="http://localhost:9001"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline inline-flex items-center gap-2 text-sm"
        >
          Abrir Console MinIO -&gt;
        </a>
      </div>
    </div>
  );
}
