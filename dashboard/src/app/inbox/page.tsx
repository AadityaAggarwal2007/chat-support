'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Conversation, Message, Site } from '@/types';
import clsx from 'clsx';
import { formatDistanceToNow, format } from 'date-fns';
import Sidebar from '@/components/Sidebar';

const STATUS_LABELS: Record<string, string> = {
  ai_handling: 'AI',
  agent_handling: 'You',
  resolved: 'Closed',
  human_needed: 'Human',
};

const STATUS_COLORS: Record<string, string> = {
  ai_handling: 'bg-blue-100 text-blue-700',
  agent_handling: 'bg-brand-600 text-white',
  resolved: 'bg-gray-100 text-gray-500',
  human_needed: 'bg-red-100 text-red-700',
};

function renderWithLinks(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all hover:opacity-80">{part}</a>
      : part
  );
}

export default function InboxPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    if (!token) { router.replace('/login'); return; }
    loadSites();
    loadConversations();
    setupSocket();
  }, []);

  useEffect(() => {
    loadConversations();
  }, [selectedSiteId, statusFilter, categoryFilter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function setupSocket() {
    const socket = getSocket();
    socket.on('connect', () => {
      sites.forEach((s) => socket.emit('join_site', s.id));
    });
    socket.on('new_message', (msg: Message & { conversationId: string }) => {
      const convId = msg.conversationId || activeConvId;
      if (convId === activeConvId) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, lastMessageAt: msg.createdAt, unreadCount: c.id === activeConvId ? 0 : c.unreadCount + 1 }
            : c
        )
      );
    });
    socket.on('conversation_updated', (updated: Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      if (activeConv?.id === updated.id) setActiveConv((prev) => ({ ...prev!, ...updated }));
    });
  }

  async function loadSites() {
    try {
      const s = await api.getSites();
      setSites(s);
      const socket = getSocket();
      s.forEach((site) => socket.emit('join_site', site.id));
    } catch {}
  }

  async function loadConversations() {
    setLoadingConvs(true);
    try {
      const params: Record<string, string> = {};
      if (selectedSiteId) params.siteId = selectedSiteId;
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      const res = await api.getConversations(params);
      setConversations(res.conversations);
    } catch {}
    setLoadingConvs(false);
  }

  async function openConversation(conv: Conversation) {
    setActiveConvId(conv.id);
    setActiveConv(conv);
    setMessages([]);
    const socket = getSocket();
    socket.emit('join_conversation', conv.id);
    try {
      const full = await api.getConversation(conv.id);
      setActiveConv(full);
      setMessages(full.messages || []);
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
      );
    } catch {}
  }

  async function sendMessage() {
    if (!draft.trim() || !activeConvId || sending) return;
    setSending(true);
    const content = draft.trim();
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const msg = await api.sendMessage(activeConvId, content);
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setActiveConv((prev) => prev ? { ...prev, status: 'agent_handling' } : prev);
      setConversations((prev) =>
        prev.map((c) => c.id === activeConvId ? { ...c, status: 'agent_handling', lastMessageAt: msg.createdAt } : c)
      );
    } catch {}
    setSending(false);
  }

  async function changeStatus(status: 'ai_handling' | 'agent_handling' | 'resolved' | 'human_needed') {
    if (!activeConvId) return;
    const socket = getSocket();
    if (status === 'resolved') socket.emit('resolve', { conversationId: activeConvId });
    else if (status === 'ai_handling') socket.emit('hand_to_ai', { conversationId: activeConvId });
    else socket.emit('take_over', { conversationId: activeConvId });
    setActiveConv((prev) => prev ? { ...prev, status } : prev);
    setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, status } : c));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />

      {/* Conversations column */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900 mb-3">Inbox</h1>

          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 mb-2 focus:outline-none focus:border-brand-500"
          >
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="flex gap-1 flex-wrap">
            {['', 'ai_handling', 'agent_handling', 'resolved', 'human_needed'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  'text-xs py-1 px-2 rounded-lg transition-colors',
                  statusFilter === s
                    ? s === 'human_needed' ? 'bg-red-600 text-white' : 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                )}
              >
                {s === '' ? 'All' : s === 'ai_handling' ? 'AI' : s === 'agent_handling' ? 'You' : s === 'resolved' ? 'Closed' : 'Human'}
              </button>
            ))}
          </div>

          <div className="flex gap-1 flex-wrap mt-2">
            {[
              { val: '', label: 'All' },
              { val: 'wrong_tracking', label: 'Wrong ID' },
              { val: 'refund', label: 'Refund' },
              { val: 'cancellation', label: 'Cancel' },
              { val: 'others', label: 'Other' },
            ].map(({ val, label }) => (
              <button
                key={val}
                onClick={() => setCategoryFilter(val)}
                className={clsx(
                  'text-xs py-1 px-2 rounded-lg transition-colors',
                  categoryFilter === val
                    ? val === 'wrong_tracking' ? 'bg-orange-500 text-white'
                    : val === 'refund' ? 'bg-purple-500 text-white'
                    : val === 'cancellation' ? 'bg-red-500 text-white'
                    : 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="p-4 text-gray-400 text-sm text-center">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-gray-400 text-sm text-center">No conversations yet</div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => openConversation(conv)}
                className={clsx(
                  'w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors',
                  activeConvId === conv.id && 'bg-blue-50 border-l-2 border-l-brand-600'
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {conv.source === 'email' && (
                      <svg className="w-3 h-3 text-brand-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                      </svg>
                    )}
                    <span className="font-medium text-sm text-gray-800 truncate">
                      {conv.visitorName || 'Visitor'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {conv.unreadCount > 0 && (
                      <span className="bg-brand-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                        {conv.unreadCount}
                      </span>
                    )}
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-md font-medium', STATUS_COLORS[conv.status])}>
                      {STATUS_LABELS[conv.status]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate mb-1">
                  <span>{conv.site?.name || ''}</span>
                  {conv.category && conv.category !== 'others' && (
                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                      conv.category === 'wrong_tracking' ? 'bg-orange-100 text-orange-700' :
                      conv.category === 'refund' ? 'bg-purple-100 text-purple-700' :
                      'bg-red-100 text-red-700'
                    )}>
                      {conv.category === 'wrong_tracking' ? 'Wrong ID' : conv.category === 'refund' ? 'Refund' : 'Cancel'}
                    </span>
                  )}
                </div>
                {conv.messages?.[0] && (
                  <div className="text-xs text-gray-500 truncate">
                    {conv.messages[0].content}
                  </div>
                )}
                {conv.lastMessageAt && (
                  <div className="text-xs text-gray-400 mt-1">
                    {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true })}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat window */}
      {activeConv ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 bg-white">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-900">{activeConv.visitorName || 'Visitor'}</h2>
                {activeConv.source === 'email' && (
                  <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                    Email
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{activeConv.site?.domain}</span>
                <span className="text-gray-300">·</span>
                <span className={clsx('text-xs px-1.5 py-0.5 rounded-md font-medium', STATUS_COLORS[activeConv.status])}>
                  {STATUS_LABELS[activeConv.status]}
                </span>
                {activeConv.category && activeConv.category !== 'others' && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-md font-medium',
                      activeConv.category === 'wrong_tracking' ? 'bg-orange-100 text-orange-700' :
                      activeConv.category === 'refund' ? 'bg-purple-100 text-purple-700' :
                      'bg-red-100 text-red-700'
                    )}>
                      {activeConv.category === 'wrong_tracking' ? 'Wrong Tracking' : activeConv.category === 'refund' ? 'Refund' : 'Cancellation'}
                    </span>
                  </>
                )}
                {activeConv.visitorPhone && (
                  <>
                    <span className="text-gray-300">·</span>
                    <a href={`tel:${activeConv.visitorPhone}`} className="text-xs text-brand-600 font-medium hover:underline">
                      {activeConv.visitorPhone}
                    </a>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeConv.status !== 'agent_handling' && (
                <button
                  onClick={() => changeStatus('agent_handling')}
                  className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Take over
                </button>
              )}
              {activeConv.status === 'agent_handling' && (
                <button
                  onClick={() => changeStatus('ai_handling')}
                  className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Hand to AI
                </button>
              )}
              {activeConv.status !== 'resolved' && (
                <button
                  onClick={() => changeStatus('resolved')}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Close
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={clsx('flex flex-col max-w-[72%]', msg.sender === 'visitor' ? 'self-end items-end' : 'self-start items-start')}
              >
                <span className="text-xs text-gray-400 mb-1 px-1">
                  {msg.sender === 'visitor' ? 'Visitor' : msg.sender === 'agent' ? 'You (Agent)' : 'AI Support'}
                </span>
                <div className={clsx(
                  msg.sender === 'visitor' ? 'chat-bubble-visitor' : msg.sender === 'agent' ? 'chat-bubble-agent' : 'chat-bubble-ai'
                )}>
                  {renderWithLinks(msg.content)}
                </div>
                <span className="text-xs text-gray-400 mt-1 px-1">
                  {format(new Date(msg.createdAt), 'HH:mm')}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {activeConv.status !== 'resolved' && (
            <div className="p-4 border-t border-gray-200 flex gap-3 items-end flex-shrink-0 bg-white">
              {activeConv.status === 'ai_handling' && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
                  AI is handling this — click Take over to respond
                </div>
              )}
              {activeConv.status === 'human_needed' && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
                  Customer needs human help — Take over to respond
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
                placeholder={activeConv.status === 'agent_handling' ? 'Type your reply… (Enter to send)' : 'Take over to reply…'}
                disabled={activeConv.status !== 'agent_handling' || sending}
                rows={1}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 resize-none disabled:opacity-50 transition-colors"
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim() || sending || activeConv.status !== 'agent_handling'}
                className="w-11 h-11 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <p className="text-lg font-medium">Select a conversation</p>
            <p className="text-sm mt-1">Pick one from the list to start</p>
          </div>
        </div>
      )}
    </div>
  );
}
