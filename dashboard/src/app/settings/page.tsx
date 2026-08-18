'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

export default function SettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ codex?: string; model?: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    if (!token) { router.replace('/login'); return; }
    fetch(`${SERVER}/health`).then(r => r.json()).then((d) => setStatus(d)).catch(() => {});
  }, []);

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

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-2">AI (Codex)</h2>
              <p className="text-gray-500 text-sm mb-4">
                AI responses are powered by your Codex gateway. Configure the model and Codex URL in the server .env file.
              </p>
              <div className="bg-gray-50 rounded-xl p-4 font-mono text-xs text-gray-600 space-y-1 border border-gray-200">
                <div><span className="text-gray-400"># server/.env</span></div>
                <div>CODEX_URL=<span className="text-green-600">http://localhost:10531</span></div>
                <div>AI_MODEL=<span className="text-green-600">gpt-5.6-sol</span></div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-2">Automation hooks</h2>
              <p className="text-gray-500 text-sm">
                Webhook endpoints for connecting with your order tracking app and other services are built into the database schema. Coming in a future update — the <code className="text-brand-600 text-xs">webhook_endpoints</code> table is ready.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
