'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { X, ChevronRight, ChevronLeft, CheckCircle2, Sparkles } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = ['Configuracao', 'Envio', 'Revisao'] as const;

interface FormData {
  name: string;
  niche: string;
  city: string;
  radius_km: number;
  daily_limit: number;
  auto_send: boolean;
  channels: string[];
}

const DEFAULT_FORM: FormData = {
  name: '',
  niche: '',
  city: '',
  radius_km: 10,
  daily_limit: 50,
  auto_send: false,
  channels: ['whatsapp'],
};

export function CampaignWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function update(key: keyof FormData, value: string | number | boolean | string[]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChannel(ch: string) {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(ch)
        ? prev.channels.filter((c) => c !== ch)
        : [...prev.channels, ch],
    }));
  }

  async function submit() {
    setLoading(true);
    setError('');

    try {
      await apiFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onCreated();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar campanha';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(11,15,20,0.74)] p-4 backdrop-blur-md">
      <div className="card relative w-full max-w-2xl overflow-hidden rounded-[26px] border-[#1F2937] p-0 shadow-[0_44px_80px_rgba(11,15,20,0.58)] animate-fade-in">
        <div className="absolute right-6 top-6 w-11 opacity-15">
          <BrandLogo mode="icon" muted />
        </div>

        <header className="border-b border-[#1F2937] px-7 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-[#5C6673]">CAMPAIGN ONBOARDING</p>
              <h2 className="mt-1 text-xl font-semibold text-[#E6EDF3]">Nova campanha</h2>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#1F2937] bg-[rgba(18,24,33,0.75)] text-[#9BA7B4] transition-colors hover:border-[rgba(239,68,68,0.45)] hover:text-[#EF4444]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {STEPS.map((item, index) => {
              const active = index === step;
              const done = index < step;
              return (
                <div key={item} className="space-y-1.5">
                  <div
                    className={`h-[3px] rounded-full ${
                      done
                        ? 'bg-[#1AA7A1]'
                        : active
                        ? 'bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)]'
                        : 'bg-[#1F2937]'
                    }`}
                  />
                  <p className={`text-xs font-semibold ${active || done ? 'text-[#E6EDF3]' : 'text-[#5C6673]'}`}>{item}</p>
                </div>
              );
            })}
          </div>
        </header>

        <div className="min-h-[360px] px-7 py-6">
          {step === 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="surface-soft flex items-start gap-3 px-3.5 py-3 text-xs text-[#9BA7B4]">
                <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#2ED1C8]" />
                Defina contexto estrategico da campanha para calibrar nicho, geografia e intensidade operacional.
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">NOME</label>
                <input
                  className="input"
                  placeholder="Ex: Restaurantes SP - Q2"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">NICHO</label>
                <input
                  className="input"
                  placeholder="Ex: Clinicas, SaaS, Bares"
                  value={form.niche}
                  onChange={(e) => update('niche', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">CIDADE</label>
                  <input
                    className="input"
                    placeholder="Sao Paulo"
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">RAIO (KM)</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="100"
                    value={form.radius_km}
                    onChange={(e) => update('radius_km', parseInt(e.target.value || '10', 10))}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <label className="mb-1.5 block text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">LIMITE DIARIO</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="500"
                  value={form.daily_limit}
                  onChange={(e) => update('daily_limit', parseInt(e.target.value || '50', 10))}
                />
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-[#9BA7B4]">CANAIS</p>
                <div className="flex flex-wrap gap-2">
                  {['whatsapp', 'email'].map((ch) => {
                    const active = form.channels.includes(ch);
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => toggleChannel(ch)}
                        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                          active
                            ? 'border-[rgba(26,167,161,0.6)] bg-[rgba(26,167,161,0.18)] text-[#2ED1C8]'
                            : 'border-[#1F2937] bg-[rgba(18,24,33,0.68)] text-[#9BA7B4] hover:text-[#E6EDF3]'
                        }`}
                      >
                        {ch === 'whatsapp' ? 'WhatsApp' : 'Email'}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="surface-soft flex items-center justify-between px-3.5 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#E6EDF3]">Envio automatico</p>
                  <p className="text-xs text-[#9BA7B4]">Dispara sem aprovacao manual</p>
                </div>
                <button
                  type="button"
                  onClick={() => update('auto_send', !form.auto_send)}
                  className={`relative h-7 w-12 rounded-full border transition-colors ${
                    form.auto_send
                      ? 'border-[rgba(26,167,161,0.66)] bg-[rgba(26,167,161,0.38)]'
                      : 'border-[#1F2937] bg-[rgba(31,41,55,0.8)]'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] h-5 w-5 rounded-full bg-[#E6EDF3] transition-transform ${
                      form.auto_send ? 'translate-x-[24px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <p className="text-sm text-[#9BA7B4]">Revise os parametros antes de iniciar a campanha.</p>
              <div className="space-y-2 rounded-2xl border border-[#1F2937] bg-[rgba(18,24,33,0.7)] p-4">
                {[
                  ['Nome', form.name],
                  ['Nicho', form.niche],
                  ['Cobertura', `${form.city} (+${form.radius_km}km)`],
                  ['Capacidade', `${form.daily_limit} envios/dia`],
                  ['Canais', form.channels.join(', ')],
                  ['Auto envio', form.auto_send ? 'Ativo' : 'Manual'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-[#1F2937] py-2 last:border-b-0 last:pb-0 first:pt-0">
                    <span className="text-xs font-semibold tracking-[0.08em] text-[#5C6673]">{k}</span>
                    <span className="text-sm font-semibold text-[#E6EDF3]">{v || '-'}</span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="rounded-xl border border-[rgba(239,68,68,0.46)] bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[#EF4444]">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[#1F2937] px-7 py-4">
          <button
            type="button"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            className="btn-outline inline-flex items-center gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="btn-primary inline-flex items-center gap-1.5"
              disabled={step === 0 && (!form.name || !form.niche || !form.city)}
            >
              Proximo
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={submit} className="btn-primary inline-flex items-center gap-1.5" disabled={loading}>
              <CheckCircle2 className="h-4 w-4" />
              {loading ? 'Criando...' : 'Criar campanha'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}