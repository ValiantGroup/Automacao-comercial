'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { X, ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = ['Configuracao', 'Envio', 'Revisao'];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-lg shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="font-bold text-white">Nova Campanha</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 px-6 py-3">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full h-1 rounded-full transition-colors ${i <= step ? 'bg-brand' : 'bg-surface-border'}`} />
              <span className={`text-xs ${i === step ? 'text-brand' : 'text-gray-500'}`}>{s}</span>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 space-y-4 min-h-56">
          {step === 0 && (
            <>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Nome da campanha</label>
                <input className="input" placeholder="Ex: Bares SP Q2" value={form.name} onChange={(e) => update('name', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Nicho</label>
                <input className="input" placeholder="Ex: Bares, Clinicas, E-commerce" value={form.niche} onChange={(e) => update('niche', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Cidade</label>
                  <input className="input" placeholder="Sao Paulo" value={form.city} onChange={(e) => update('city', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Raio (km)</label>
                  <input className="input" type="number" min="1" max="100" value={form.radius_km} onChange={(e) => update('radius_km', parseInt(e.target.value || '10', 10))} />
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Limite diario de envios</label>
                <input className="input" type="number" min="1" max="500" value={form.daily_limit} onChange={(e) => update('daily_limit', parseInt(e.target.value || '50', 10))} />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Canais de envio</label>
                <div className="flex gap-2">
                  {['whatsapp', 'email'].map((ch) => (
                    <button key={ch} onClick={() => toggleChannel(ch)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${form.channels.includes(ch) ? 'bg-brand/20 border-brand text-brand' : 'border-surface-border text-gray-400 hover:text-white'}`}>
                      {ch === 'whatsapp' ? 'WhatsApp' : 'Email'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between py-2 px-3 bg-surface rounded-lg border border-surface-border">
                <div>
                  <p className="text-sm font-medium text-white">Envio automatico</p>
                  <p className="text-xs text-gray-400">Enviar sem aprovacao manual</p>
                </div>
                <button onClick={() => update('auto_send', !form.auto_send)} className={`relative w-11 h-6 rounded-full transition-colors ${form.auto_send ? 'bg-brand' : 'bg-surface-border'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.auto_send ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">Confirme os detalhes:</p>
              {[
                ['Nome', form.name],
                ['Nicho', form.niche],
                ['Cidade', `${form.city} (+${form.radius_km}km)`],
                ['Limite diario', `${form.daily_limit} envios`],
                ['Canais', form.channels.join(', ')],
                ['Auto-envio', form.auto_send ? 'Sim' : 'Nao'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-gray-400">{k}</span>
                  <span className="text-white font-medium">{v || '-'}</span>
                </div>
              ))}
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
          <button onClick={() => (step > 0 ? setStep(step - 1) : onClose())} className="btn-outline flex items-center gap-1.5 text-sm">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} className="btn-primary flex items-center gap-1.5 text-sm" disabled={step === 0 && (!form.name || !form.niche || !form.city)}>
              Proximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={submit} className="btn-primary flex items-center gap-1.5 text-sm" disabled={loading}>
              <CheckCircle className="w-4 h-4" /> {loading ? 'Criando...' : 'Criar Campanha'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
