const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('chat_token');
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${SERVER}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

export const api = {
  // Auth
  login: (password: string) =>
    request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  verify: () => request<{ ok: boolean }>('/auth/verify'),

  // Sites
  getSites: () => request<import('@/types').Site[]>('/sites'),
  getSite: (id: string) => request<import('@/types').Site>(`/sites/${id}`),
  createSite: (data: { name: string; domain: string; systemPrompt?: string; aiEnabled?: boolean }) =>
    request<import('@/types').Site>('/sites', { method: 'POST', body: JSON.stringify(data) }),
  updateSite: (id: string, data: Partial<{ name: string; domain: string; systemPrompt: string; aiEnabled: boolean }>) =>
    request<import('@/types').Site>(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSite: (id: string) => request<{ ok: boolean }>(`/sites/${id}`, { method: 'DELETE' }),
  regenerateKey: (id: string) => request<{ widgetKey: string }>(`/sites/${id}/regenerate-key`, { method: 'POST' }),

  // Conversations
  getConversations: (params?: { siteId?: string; status?: string; category?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.siteId) q.set('siteId', params.siteId);
    if (params?.status) q.set('status', params.status);
    if (params?.category) q.set('category', params.category);
    if (params?.page) q.set('page', String(params.page));
    return request<import('@/types').ConversationsResponse>(`/conversations?${q}`);
  },
  getConversation: (id: string) =>
    request<import('@/types').Conversation>(`/conversations/${id}`),
  updateConversationStatus: (id: string, status: string) =>
    request<import('@/types').Conversation>(`/conversations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Messages
  sendMessage: (conversationId: string, content: string) =>
    request<import('@/types').Message>('/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId, content }),
    }),

  // Email accounts
  getSiteEmails: (siteId: string) =>
    request<{ id: string; email: string; createdAt: string }[]>(`/sites/${siteId}/emails`),
  addSiteEmail: (siteId: string, email: string, appPassword: string) =>
    request<{ id: string; email: string; createdAt: string }>(`/sites/${siteId}/emails`, {
      method: 'POST',
      body: JSON.stringify({ email, appPassword }),
    }),
  deleteSiteEmail: (siteId: string, emailId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/emails/${emailId}`, { method: 'DELETE' }),
};
