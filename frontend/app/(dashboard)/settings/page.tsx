'use client';

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-gray-400 mt-1">Configurações do sistema e integrações</p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-white">Integrações</h2>
        {[
          { label: 'WhatsApp (Evolution API)', status: 'Verificar no .env', color: 'text-gray-400' },
          { label: 'OpenAI GPT-4o', status: 'Verificar no .env', color: 'text-gray-400' },
          { label: 'Google Maps API', status: 'Verificar no .env', color: 'text-gray-400' },
          { label: 'SendGrid', status: 'Verificar no .env', color: 'text-gray-400' },
          { label: 'Apollo.io', status: 'Verificar no .env', color: 'text-gray-400' },
        ].map((item) => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
            <span className="text-sm text-gray-300">{item.label}</span>
            <span className={`text-xs ${item.color}`}>{item.status}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="font-semibold text-white mb-3">Filas de processamento</h2>
        <p className="text-sm text-gray-400 mb-3">Monitore as filas em tempo real via Asynqmon:</p>
        <a href="http://localhost:8082" target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center gap-2 text-sm">
          Abrir Asynqmon →
        </a>
      </div>

      <div className="card">
        <h2 className="font-semibold text-white mb-3">MinIO Storage</h2>
        <a href="http://localhost:9001" target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center gap-2 text-sm">
          Abrir Console MinIO →
        </a>
      </div>
    </div>
  );
}
