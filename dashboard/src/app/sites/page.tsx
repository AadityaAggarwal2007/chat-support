'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Site } from '@/types';
import Sidebar from '@/components/Sidebar';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

function EmbedModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const snippet = `<script
  src="${SERVER}/widget.js"
  data-site-key="${site.widgetKey}"
  data-title="Chat with us"
  defer
></script>`;

  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Embed on {site.name}</h2>
          <p className="text-gray-500 text-sm mt-1">Paste this before the closing &lt;/body&gt; tag in your Shopify theme</p>
        </div>

        <div className="p-6">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm text-gray-700 border border-gray-200 overflow-x-auto whitespace-pre">
            {snippet}
          </div>

          <div className="mt-4 bg-blue-50 rounded-xl p-4 text-sm text-gray-600 border border-blue-100">
            <p className="font-medium text-gray-800 mb-2">For Shopify:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to Online Store → Themes → Edit code</li>
              <li>Open <code className="text-brand-600">theme.liquid</code></li>
              <li>Paste the code above just before <code className="text-brand-600">&lt;/body&gt;</code></li>
              <li>Save — the chat button will appear on all pages</li>
            </ol>
          </div>

          <div className="flex gap-3 mt-5">
            <button
              onClick={copy}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl font-medium transition-colors"
            >
              {copied ? 'Copied!' : 'Copy snippet'}
            </button>
            <button
              onClick={onClose}
              className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditSiteModal({ site, onClose, onSaved }: { site: Site; onClose: () => void; onSaved: (s: Site) => void }) {
  const [form, setForm] = useState({ name: site.name, domain: site.domain, systemPrompt: site.systemPrompt || '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const updated = await api.updateSite(site.id, form);
      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Edit {site.name}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-brand-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Domain</label>
            <input
              type="text"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="mystore.myshopify.com"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">AI instructions <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 text-sm resize-none"
            />
          </div>
          {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors">
              {loading ? 'Saving...' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose} className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type SiteEmailAccount = { id: string; email: string; createdAt: string };

function EmailAccountsPanel({ site }: { site: Site }) {
  const [accounts, setAccounts] = useState<SiteEmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSiteEmails(site.id).then(setAccounts).catch(() => {}).finally(() => setLoading(false));
  }, [site.id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const acc = await api.addSiteEmail(site.id, email, appPassword);
      setAccounts((prev) => [...prev, acc]);
      setEmail('');
      setAppPassword('');
      setShowForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    }
    setSaving(false);
  }

  async function remove(id: string) {
    if (!confirm('Remove this email account?')) return;
    await api.deleteSiteEmail(site.id, id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email accounts</p>
        {accounts.length < 3 && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : accounts.length === 0 && !showForm ? (
        <p className="text-xs text-gray-400 italic">No email accounts yet — AI will only handle chat.</p>
      ) : (
        <div className="space-y-1.5">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                </svg>
                <span className="text-xs text-gray-700 font-medium">{acc.email}</span>
              </div>
              <button onClick={() => remove(acc.id)} className="text-xs text-red-500 hover:text-red-600 ml-3">Remove</button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form onSubmit={add} className="mt-3 space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="support@gmail.com"
            required
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500"
          />
          <input
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="Gmail App Password (16 chars)"
            required
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2 rounded-lg font-medium transition-colors">
              {saving ? 'Adding...' : 'Add email'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs py-2 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Use a Gmail App Password — go to Google Account → Security → 2-Step Verification → App passwords.
          </p>
        </form>
      )}
    </div>
  );
}

function AddSiteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Site) => void }) {
  const [form, setForm] = useState({ name: '', domain: '', systemPrompt: '', aiEnabled: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const site = await api.createSite(form);
      onCreated(site);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create site');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Add a site</h2>
          <p className="text-gray-500 text-sm mt-1">Connect a new website to receive chats</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Shopify Store"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Domain</label>
            <input
              type="text"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="mystore.myshopify.com"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">AI instructions <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="You are a helpful support assistant for [store name]..."
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 text-sm resize-none"
            />
          </div>
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
            <span className="text-sm text-gray-700">AI auto-respond</span>
            <button
              type="button"
              onClick={() => setForm({ ...form, aiEnabled: !form.aiEnabled })}
              className={`w-10 h-6 rounded-full transition-colors ${form.aiEnabled ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-1 ${form.aiEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors"
            >
              {loading ? 'Creating...' : 'Add site'}
            </button>
            <button type="button" onClick={onClose} className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SitesPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [embedSite, setEmbedSite] = useState<Site | null>(null);
  const [editSite, setEditSite] = useState<Site | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    if (!token) { router.replace('/login'); return; }
    load();
  }, []);

  async function load() {
    try {
      const s = await api.getSites();
      setSites(s);
    } catch {}
    setLoading(false);
  }

  async function deleteSite(id: string) {
    if (!confirm('Delete this site and all its conversations?')) return;
    await api.deleteSite(id);
    setSites((prev) => prev.filter((s) => s.id !== id));
  }

  async function toggleAI(site: Site) {
    const updated = await api.updateSite(site.id, { aiEnabled: !site.aiEnabled });
    setSites((prev) => prev.map((s) => (s.id === site.id ? updated : s)));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sites</h1>
              <p className="text-gray-500 mt-1">Manage connected websites and get embed codes</p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              Add site
            </button>
          </div>

          {loading ? (
            <div className="text-gray-400 text-center py-16">Loading...</div>
          ) : sites.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-300 rounded-2xl">
              <p className="text-gray-500 mb-3">No sites connected yet</p>
              <button onClick={() => setShowAdd(true)} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                Add your first site →
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {sites.map((site) => (
                <div key={site.id} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold text-gray-900">{site.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${site.aiEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {site.aiEnabled ? 'AI on' : 'AI off'}
                        </span>
                      </div>
                      <p className="text-gray-500 text-sm">{site.domain || <span className="text-orange-500 italic">No domain set — click Edit</span>}</p>
                      <p className="text-gray-400 text-xs mt-1">{site._count?.conversations || 0} conversations</p>
                    </div>

                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <button
                        onClick={() => setEmbedSite(site)}
                        className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        Get code
                      </button>
                      <button
                        onClick={() => setEditSite(site)}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleAI(site)}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {site.aiEnabled ? 'Disable AI' : 'Enable AI'}
                      </button>
                      <button
                        onClick={() => deleteSite(site.id)}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-400 font-mono break-all">
                      Widget key: <span className="text-gray-600">{site.widgetKey}</span>
                    </p>
                    <EmailAccountsPanel site={site} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddSiteModal
          onClose={() => setShowAdd(false)}
          onCreated={(s) => { setSites((prev) => [s, ...prev]); setShowAdd(false); setEmbedSite(s); }}
        />
      )}

      {embedSite && <EmbedModal site={embedSite} onClose={() => setEmbedSite(null)} />}
      {editSite && (
        <EditSiteModal
          site={editSite}
          onClose={() => setEditSite(null)}
          onSaved={(updated) => { setSites((prev) => prev.map((s) => (s.id === updated.id ? updated : s))); setEditSite(null); }}
        />
      )}
    </div>
  );
}
