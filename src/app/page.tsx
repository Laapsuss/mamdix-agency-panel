'use client';
import React, { useState } from 'react';

type Step = {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
}

type ProvisionResult = {
  success?: boolean
  error?: string
  urls?: { backend_admin: string; storefront: string }
  repositories?: { backend: string; storefront: string }
  notes?: string[]
}

const STEPS_CONFIG: Omit<Step, 'status'>[] = [
  { id: 'supabase', label: 'Crear base de datos (Supabase)' },
  { id: 'supabase_wait', label: 'Esperar instancia Supabase activa' },
  { id: 'github_backend', label: 'Clonar repositorio Backend (GitHub)' },
  { id: 'github_storefront', label: 'Clonar repositorio Storefront (GitHub)' },
  { id: 'coolify_backend', label: 'Crear servicio Backend (Coolify)' },
  { id: 'coolify_backend_env', label: 'Configurar ENV del Backend' },
  { id: 'coolify_backend_domain', label: 'Configurar dominio y alias de red' },
  { id: 'coolify_storefront', label: 'Crear servicio Storefront (Coolify)' },
  { id: 'coolify_storefront_env', label: 'Configurar ENV y dominio del Storefront' },
  { id: 'deploy', label: 'Disparar deploys iniciales' },
]

export default function Home() {
  const [clientName, setClientName] = useState('');
  const [slug, setSlug] = useState('');
  const [baseDomain, setBaseDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [steps, setSteps] = useState<Step[]>(
    STEPS_CONFIG.map(s => ({ ...s, status: 'pending' }))
  );

  // Auto-generate slug from clientName
  const handleClientNameChange = (val: string) => {
    setClientName(val);
    if (!slug || slug === clientName.toLowerCase().replace(/[^a-z0-9]/g, '-')) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  const updateStep = (index: number, status: Step['status']) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, status } : s));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    // Reset steps
    setSteps(STEPS_CONFIG.map(s => ({ ...s, status: 'pending' })));

    // Simulate step progress while request is ongoing
    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < STEPS_CONFIG.length) {
        if (stepIndex > 0) updateStep(stepIndex - 1, 'done');
        updateStep(stepIndex, 'running');
        // Supabase wait step is much longer
        stepIndex++;
      } else {
        clearInterval(interval);
      }
    }, stepIndex === 1 ? 40000 : 3000);

    try {
      const res = await fetch('/api/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, slug, baseDomain })
      });

      clearInterval(interval);
      const data: ProvisionResult = await res.json();

      if (res.ok && data.success) {
        setSteps(STEPS_CONFIG.map(s => ({ ...s, status: 'done' })));
        setResult(data);
      } else {
        setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
        setResult(data);
      }
    } catch (error: any) {
      clearInterval(interval);
      setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const isComplete = result?.success;

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center py-16 px-4">
      <div className="max-w-2xl w-full space-y-8">

        {/* Header */}
        <header className="border-b border-neutral-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">M</div>
            <div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Mamdix <span className="text-indigo-400">Agency</span></h1>
              <p className="text-neutral-500 text-xs mt-0.5">Infrastructure Provisioning Dashboard</p>
            </div>
          </div>
        </header>

        {/* Form */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-medium mb-6 text-neutral-100">Nuevo Ecosistema de Cliente</h2>
          <form className="space-y-4" onSubmit={handleSubmit}>

            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5 uppercase tracking-wider">Nombre del Cliente / Marca</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => handleClientNameChange(e.target.value)}
                required
                placeholder="Ej: Lattafa Perfumes"
                disabled={loading}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5 uppercase tracking-wider">Slug (ID corto)</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                required
                placeholder="Ej: lattafa"
                disabled={loading}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-mono disabled:opacity-50"
              />
              <p className="text-xs text-neutral-600 mt-1">Se usará para: repos GitHub, nombre en Coolify y dominios.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5 uppercase tracking-wider">Dominio Base</label>
              <input
                type="text"
                value={baseDomain}
                onChange={(e) => setBaseDomain(e.target.value)}
                required
                placeholder="Ej: lattafa.mamdix.cloud"
                disabled={loading}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-mono disabled:opacity-50"
              />
              {baseDomain && (
                <div className="mt-2 flex gap-4">
                  <span className="text-xs text-neutral-500">Admin: <span className="text-indigo-400">admin.{baseDomain}</span></span>
                  <span className="text-xs text-neutral-500">Shop: <span className="text-indigo-400">shop.{baseDomain}</span></span>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || !clientName || !slug || !baseDomain}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg px-4 py-3 font-medium tracking-wide transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                    <span>Aprovisionando ecosistema...</span>
                  </>
                ) : (
                  <>
                    <span>⚡ Instanciar Ecosistema Completo</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Progress Steps */}
        {(loading || isComplete || result?.error) && (
          <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase tracking-wider">Progreso</h3>
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-5 text-center">
                    {step.status === 'done' && <span className="text-green-400 text-sm">✓</span>}
                    {step.status === 'running' && <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />}
                    {step.status === 'error' && <span className="text-red-400 text-sm">✗</span>}
                    {step.status === 'pending' && <span className="text-neutral-700 text-sm">○</span>}
                  </span>
                  <span className={`text-sm ${step.status === 'done' ? 'text-neutral-300' :
                      step.status === 'running' ? 'text-white font-medium' :
                        step.status === 'error' ? 'text-red-400' :
                          'text-neutral-600'
                    }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Result */}
        {result && (
          <section className={`border rounded-2xl p-6 ${result.success
              ? 'bg-green-950/20 border-green-900/40'
              : 'bg-red-950/20 border-red-900/40'
            }`}>
            {result.success ? (
              <>
                <h3 className="text-green-400 font-semibold mb-4">✅ Ecosistema aprovisionado con éxito</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">URLs</p>
                    <a href={result.urls?.backend_admin} target="_blank" rel="noopener noreferrer"
                      className="block text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                      🔗 Admin: {result.urls?.backend_admin}
                    </a>
                    <a href={result.urls?.storefront} target="_blank" rel="noopener noreferrer"
                      className="block text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                      🛍️ Shop: {result.urls?.storefront}
                    </a>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Repositorios</p>
                    <a href={result.repositories?.backend} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-neutral-400 hover:text-neutral-300 font-mono">{result.repositories?.backend}</a>
                    <a href={result.repositories?.storefront} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-neutral-400 hover:text-neutral-300 font-mono">{result.repositories?.storefront}</a>
                  </div>
                  {result.notes && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Próximos pasos</p>
                      {result.notes.map((note, i) => (
                        <p key={i} className="text-xs text-neutral-400">{note}</p>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-red-400 font-semibold mb-2">❌ Error en el aprovisionamiento</h3>
                <p className="text-xs text-red-300 font-mono">{result.error}</p>
                <p className="text-xs text-neutral-500 mt-2">→ El rollback automático ha limpiado los recursos creados.</p>
              </>
            )}
          </section>
        )}

        <div className="text-xs text-neutral-700 font-mono flex items-center gap-2">
          <span className="flex w-2 h-2 bg-green-600 rounded-full animate-pulse" />
          Sistema conectado · Rollback automático activo
        </div>
      </div>
    </main>
  );
}
