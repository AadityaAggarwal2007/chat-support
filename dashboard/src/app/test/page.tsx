'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Site, Message } from '@/types';
import Sidebar from '@/components/Sidebar';
import { format } from 'date-fns';
import clsx from 'clsx';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
function newVisitorId(siteId: string) {
  return `test-preview-${siteId}-${Date.now()}`;
}

export default function TestPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('ai_handling');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastTsRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    if (!token) { router.replace('/login'); return; }
    api.getSites().then(setSites).catch(() => {});
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startSession(site: Site) {
    setSelectedSite(site);
    setMessages([]);
    setConversationId(null);
    setStatus('ai_handling');
    lastTsRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    setLoading(true);

    try {
      const res = await fetch(`${SERVER}/api/widget/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey: site.widgetKey,
          visitorId: newVisitorId(site.id),
          visitorName: 'Test (You)',
        }),
      });
      const data = await res.json();
      setConversationId(data.conversationId);
      setStatus(data.status);

      const msgRes = await fetch(`${SERVER}/api/widget/messages/${data.conversationId}?siteKey=${site.widgetKey}`);
      const msgData = await msgRes.json();
      if (msgData.messages) {
        setMessages(msgData.messages);
        if (msgData.messages.length > 0) {
          lastTsRef.current = msgData.messages[msgData.messages.length - 1].createdAt;
        }
      }

      pollRef.current = setInterval(() => pollMessages(data.conversationId, site.widgetKey), 2500);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function pollMessages(convId: string, widgetKey: string) {
    try {
      const url = `${SERVER}/api/widget/messages/${convId}?siteKey=${widgetKey}${lastTsRef.current ? `&since=${lastTsRef.current}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.messages?.length > 0) {
        setMessages((prev) => {
          const newMsgs = data.messages.filter((m: Message) => !prev.find((p) => p.id === m.id));
          if (newMsgs.length === 0) return prev;
          lastTsRef.current = data.messages[data.messages.length - 1].createdAt;
          return [...prev, ...newMsgs];
        });
      }
      if (data.status) setStatus(data.status);
    } catch {}
  }

  async function sendMessage() {
    if (!draft.trim() || !conversationId || !selectedSite || sending) return;
    const content = draft.trim();
    setDraft('');
    setSending(true);

    const tempId = 'tmp_' + Date.now();
    const tempMsg: Message = {
      id: tempId, conversationId: conversationId!, sender: 'visitor',
      content, createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch(`${SERVER}/api/widget/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, siteKey: selectedSite.widgetKey, content }),
      });
      const data = await res.json();

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        const alreadyHas = (id: string) => withoutTemp.some((m) => m.id === id);
        const msgs = data.message && !alreadyHas(data.message.id)
          ? [...withoutTemp, data.message]
          : withoutTemp;
        if (data.aiResponse && !msgs.find((m) => m.id === data.aiResponse.id)) {
          return [...msgs, data.aiResponse];
        }
        return msgs;
      });

      if (data.message) lastTsRef.current = data.message.createdAt;
    } catch {}
    setSending(false);
    inputRef.current?.focus();
  }

  function resetSession() {
    setSelectedSite(null);
    setConversationId(null);
    setMessages([]);
    if (pollRef.current) clearInterval(pollRef.current);
  }

  const senderLabel: Record<string, string> = {
    visitor: 'You (testing as visitor)',
    ai: 'AI Support',
    agent: 'Agent',
  };

  function renderWithLinks(text: string) {
    const parts = text.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all hover:opacity-80">{part}</a>
        : part
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left — site picker */}
        <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-5 border-b border-gray-200">
            <h1 className="text-lg font-bold text-gray-900">Test Chat</h1>
            <p className="text-gray-500 text-sm mt-1">Simulate a visitor conversation before going live</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {sites.length === 0 ? (
              <p className="text-gray-400 text-sm text-center pt-8">No sites yet — add one in Sites first</p>
            ) : (
              sites.map((site) => (
                <button
                  key={site.id}
                  onClick={() => startSession(site)}
                  className={clsx(
                    'w-full text-left p-4 rounded-xl border transition-all',
                    selectedSite?.id === site.id
                      ? 'border-brand-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <div className="font-medium text-gray-900 text-sm">{site.name}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{site.domain}</div>
                  <div className={clsx('text-xs mt-2 flex items-center gap-1.5', site.aiEnabled ? 'text-blue-600' : 'text-gray-400')}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full', site.aiEnabled ? 'bg-blue-500' : 'bg-gray-400')} />
                    {site.aiEnabled ? 'AI enabled' : 'AI disabled'}
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedSite && (
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={resetSession}
                className="w-full text-sm text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition-colors"
              >
                Clear & pick another site
              </button>
            </div>
          )}
        </div>

        {/* Right — chat preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedSite ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-400 max-w-xs">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                <p className="text-lg font-medium">Pick a site to test</p>
                <p className="text-sm mt-1">You'll chat as a visitor and see exactly what your customers see</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900 font-semibold">{selectedSite.name}</span>
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">TEST MODE</span>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                      status === 'ai_handling' ? 'bg-blue-100 text-blue-700' :
                      status === 'agent_handling' ? 'bg-brand-600 text-white' :
                      'bg-gray-100 text-gray-500'
                    )}>
                      {status === 'ai_handling' ? 'AI handling' : status === 'agent_handling' ? 'Agent handling' : 'Resolved'}
                    </span>
                  </div>
                  <p className="text-gray-400 text-xs mt-0.5">You are chatting as a visitor — this is exactly what your customers will see</p>
                </div>
                <button
                  onClick={() => startSession(selectedSite)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  New conversation
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
                {loading ? (
                  <div className="text-gray-400 text-sm text-center pt-8">Starting session...</div>
                ) : messages.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center pt-8">
                    Send a message to start — try "where is my order?"
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={clsx('flex flex-col max-w-[72%]',
                        msg.sender === 'visitor' ? 'self-end items-end' : 'self-start items-start'
                      )}
                    >
                      <span className="text-xs text-gray-400 mb-1 px-1">{senderLabel[msg.sender] || msg.sender}</span>
                      <div className={clsx(
                        msg.sender === 'visitor' ? 'chat-bubble-visitor' :
                        msg.sender === 'agent' ? 'chat-bubble-agent' : 'chat-bubble-ai'
                      )}>
                        {renderWithLinks(msg.content)}
                      </div>
                      <span className="text-xs text-gray-400 mt-1 px-1">
                        {format(new Date(msg.createdAt), 'HH:mm')}
                      </span>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="self-start flex gap-1 items-center bg-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-gray-200 bg-white flex gap-3 items-end flex-shrink-0">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder='Try: "where is my order?" or "track my package"'
                  rows={1}
                  disabled={sending || loading}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 resize-none disabled:opacity-50 transition-colors"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!draft.trim() || sending || loading}
                  className="w-11 h-11 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
