export interface Site {
  id: string;
  name: string;
  domain: string;
  widgetKey: string;
  aiEnabled: boolean;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { conversations: number };
}

export interface Message {
  id: string;
  conversationId: string;
  sender: 'visitor' | 'ai' | 'agent';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Conversation {
  id: string;
  siteId: string;
  visitorId: string;
  visitorName: string | null;
  visitorPhone: string | null;
  status: 'ai_handling' | 'agent_handling' | 'resolved' | 'human_needed';
  source: 'chat' | 'email';
  category: 'wrong_tracking' | 'refund' | 'cancellation' | 'others';
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  site?: { id: string; name: string; domain: string };
  messages?: Message[];
}

export interface ConversationsResponse {
  conversations: Conversation[];
  total: number;
  page: number;
  limit: number;
}
