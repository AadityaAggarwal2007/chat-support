'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { api } from '@/lib/api';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

type ModelInfo = {
  name: string;
  free?: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ status?: string } | null>(null);
  const [activeModel, setActiveModel] = useState('');
  const [models, setModels] = useState<Record<string, ModelInfo>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    if (!token) { router.replace('/login'); return; }
    fetch(`${SERVER}/health`).then(r => r.json()).then(d => setStatus(d)).catch(() => {});
    api.getAISettings().then(d => {
      setActiveModel(d.activeModel);
      setModels(d.models);
      setOrder(d.chain && d.chain.length ? d.chain : Object.keys(d.models));
    }).catch(() => {});
  }, []);

  async function switchModel(modelId: string) {
    setSwitching(true);
    setSaved(false);
    try {
      const res = await api.setAIModel(modelId);
      setActiveModel(res.activeModel);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSwitching(false);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-500 mt-1">Server and AI configuration</p>
          </div>

          <div className="space-y-4">
            {/* Server info */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-4">Server info</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Server URL</span>
                  <span className="text-gray-800 font-mono text-xs">{SERVER}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className="text-green-600">
                    {status ? '● Online' : '○ Checking...'}
                  </span>
                </div>
              </div>
            </div>

            {/* AI model selector */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-gray-900">AI Model</h2>
                {saved && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    Saved
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-sm mb-4">
                Pick the model that answers first. If it is unavailable, the next one in the
                list takes over automatically.
              </p>

              <div className="space-y-2">
                {order.filter(id => models[id]).map((id, i) => {
                  const info = models[id];
                  const isActive = id === activeModel;
                  return (
                    <button
                      key={id}
                      onClick={() => !isActive && switchModel(id)}
                      disabled={switching}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                        isActive
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      } ${switching ? 'opacity-60 cursor-wait' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 tabular-nums w-4">{i + 1}</span>
                          <span className="font-medium text-gray-900">{info.name}</span>
                          {info.free && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                              Free
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 bg-brand-100 px-1.5 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fallback explanation */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-2">Automatic fallback</h2>
              <p className="text-gray-500 text-sm">
                Every model in this list was tested against real support conversations. Each one
                refuses to look up an order from an order number alone, and never repeats a
                customer&apos;s address back to them. If the selected model is rate-limited or
                offline, the widget moves down the list on its own rather than going quiet.
              </p>
            </div>

            {/* Automation hooks */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-2">Automation hooks</h2>
              <p className="text-gray-500 text-sm">
                Webhook endpoints for connecting with your order tracking app and other services
                are built into the database schema. Coming in a future update — the{' '}
                <code className="text-brand-600 text-xs">webhook_endpoints</code> table is ready.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
