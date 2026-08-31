import { Company, Task, Document, UserSettings, ScheduledMessage } from '../types';

const API_URL = '/api';
const TOKEN_KEY = 'cm_auth_token';
const AGENT_KEY = 'cm_auth_agent';

// token pode estar em localStorage (permanecer conectado) ou sessionStorage (sessão)
export const auth = {
  getToken: (): string | null =>
    localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY),
  getAgent: (): any | null => {
    const raw = localStorage.getItem(AGENT_KEY) || sessionStorage.getItem(AGENT_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  set: (token: string, agent: any, remember: boolean) => {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    other.removeItem(TOKEN_KEY); other.removeItem(AGENT_KEY);
    store.setItem(TOKEN_KEY, token);
    if (agent) store.setItem(AGENT_KEY, JSON.stringify(agent));
  },
  clear: () => {
    [localStorage, sessionStorage].forEach(s => { s.removeItem(TOKEN_KEY); s.removeItem(AGENT_KEY); });
  },
};

const getHeaders = (): Record<string, string> => {
  const token = auth.getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
};

const getAuthHeader = (): Record<string, string> => {
  const token = auth.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const handleResponse = async (res: Response) => {
  const contentType = res.headers.get("content-type");
  const isJson = contentType && contentType.indexOf("application/json") !== -1;
  const data = isJson ? await res.json().catch(() => ({})) : { _text: await res.text().catch(() => '') };

  if (res.status === 401) {
    // sessão expirada / revogada -> desloga
    auth.clear();
    if (!window.location.pathname.startsWith('/definir-acesso')) window.location.href = '/';
    throw new Error(data.error || "Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    // 403 (sem permissão) e demais erros: propaga a mensagem, NÃO desloga
    throw new Error(data.error || data._text || `Erro ${res.status}`);
  }
  return isJson ? data : { success: true };
};

export const api = {
  // --- Autenticação ---
  login: async (user: string, pass: string): Promise<{ success: boolean; token?: string; agent?: any; error?: string }> => {
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password: pass }),
      });
      return await handleResponse(res);
    } catch (error: any) {
      return { success: false, error: error?.message || 'Erro ao conectar com o servidor.' };
    }
  },

  me: async (): Promise<any> => {
    const res = await fetch(`${API_URL}/auth/me`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  // lista enxuta de colaboradores ativos p/ o seletor "responsável" do Kanban
  listTeamAgents: async (): Promise<{ id: number; name: string; department: string | null; role: string }[]> => {
    const res = await fetch(`${API_URL}/auth/agents`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  // layout do Kanban — colunas/tags/setores/limiares (só admin do .env)
  saveKanban: async (waKanban: any): Promise<{ success: boolean; waKanban: any }> => {
    const res = await fetch(`${API_URL}/kanban`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(waKanban) });
    return handleResponse(res);
  },

  // --- Inbox de atendimento (conversas) ---
  getInbox: async (params: { filter?: string; department?: string; resolved?: boolean } = {}): Promise<any[]> => {
    const q = new URLSearchParams();
    if (params.filter) q.set('filter', params.filter);
    if (params.department) q.set('department', params.department);
    if (params.resolved) q.set('resolved', '1');
    const res = await fetch(`${API_URL}/inbox?${q}`, { headers: getAuthHeader() });
    return handleResponse(res);
  },
  patchConversation: async (chatId: string, patch: Record<string, any>): Promise<{ conversation: any }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify(patch) });
    return handleResponse(res);
  },
  claimConversation: async (chatId: string, force = false): Promise<{ conversation?: any; conflict?: boolean; current?: { agentId: number; name: string } }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}/claim`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ force }) });
    if (res.status === 409) return res.json();
    return handleResponse(res);
  },
  setConversationStatus: async (chatId: string, action: 'resolve' | 'reopen'): Promise<{ conversation: any }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}/${action}`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },
  transferConversation: async (chatId: string, payload: { toAgentId?: number | null; toDepartment?: string | null; note?: string }): Promise<{ conversation: any }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}/transfer`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    return handleResponse(res);
  },
  deleteConversation: async (chatId: string): Promise<{ deleted: boolean; messages: number }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}`, { method: 'DELETE', headers: getAuthHeader() });
    return handleResponse(res);
  },
  // observações + histórico de atendimento de uma conversa
  getConversationEvents: async (chatId: string): Promise<{
    note: string;
    events: { id: number; kind: string; detail: string | null; agentId: number | null; agentName: string | null; createdAt: string }[];
  }> => {
    const res = await fetch(`${API_URL}/inbox/${encodeURIComponent(chatId)}/events`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  // --- Admin (só o admin do .env) ---
  importLegacy: async (payload: { file?: string; dry?: boolean } = {}): Promise<{ success: boolean; dry: boolean; file: string; stats: Record<string, number> }> => {
    const res = await fetch(`${API_URL}/admin/import-legacy`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    return handleResponse(res);
  },

  // presença: heartbeat "estou com essa conversa aberta" -> devolve quem mais está
  setChatViewing: async (chatId: string): Promise<{ viewers: { agentId: number; name: string; department: string | null; since: number }[] }> => {
    const res = await fetch(`${API_URL}/whatsapp/viewing/${encodeURIComponent(chatId)}`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },
  clearChatViewing: async (chatId: string): Promise<void> => {
    try {
      await fetch(`${API_URL}/whatsapp/viewing/${encodeURIComponent(chatId)}`, { method: 'DELETE', headers: getAuthHeader(), keepalive: true });
    } catch { /* best-effort */ }
  },

  // --- Convite / definição de acesso (páginas públicas) ---
  getInvite: async (token: string): Promise<{ name: string; email: string; reset: boolean }> => {
    const res = await fetch(`${API_URL}/auth/invite?token=${encodeURIComponent(token)}`);
    return handleResponse(res);
  },
  activateInvite: async (token: string, username: string, password: string): Promise<{ success: boolean }> => {
    const res = await fetch(`${API_URL}/auth/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username, password }),
    });
    return handleResponse(res);
  },

  // --- Gestão de colaboradores (admin) ---
  listAgents: async (): Promise<{ agents: any[]; tabs: string[]; defaultPermissions: any }> => {
    const res = await fetch(`${API_URL}/agents`, { headers: getAuthHeader() });
    return handleResponse(res);
  },
  createAgent: async (payload: { name: string; email: string; department?: string; role?: string; permissions: any; emailAlias?: string; emailFromName?: string }): Promise<any> => {
    const res = await fetch(`${API_URL}/agents`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    return handleResponse(res);
  },
  updateAgent: async (id: number, payload: { name?: string; email?: string; department?: string; role?: string; permissions?: any; emailAlias?: string; emailFromName?: string }): Promise<any> => {
    const res = await fetch(`${API_URL}/agents/${id}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(payload) });
    return handleResponse(res);
  },
  agentAction: async (id: number, action: 'revoke' | 'reactivate' | 'reset-password' | 'resend-invite'): Promise<any> => {
    const res = await fetch(`${API_URL}/agents/${id}/${action}`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },

  // Settings
  getSettings: async (): Promise<UserSettings | null> => {
      const res = await fetch(`${API_URL}/settings`, { headers: getAuthHeader() });
      if (!res.ok) return null;
      return res.json();
  },
  
  saveSettings: async (settings: UserSettings): Promise<void> => {
      const res = await fetch(`${API_URL}/settings`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(settings)
      });
      return handleResponse(res);
  },

  // Trigger Daily Summary Manually
  triggerDailySummary: async (): Promise<void> => {
      const res = await fetch(`${API_URL}/trigger-daily-summary`, { method: 'POST', headers: getAuthHeader() });
      return handleResponse(res);
  },

  // Companies
  getCompanies: async (): Promise<Company[]> => {
    const res = await fetch(`${API_URL}/companies`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  saveCompany: async (company: Partial<Company>): Promise<{ success: boolean; id: number }> => {
    const res = await fetch(`${API_URL}/companies`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(company),
    });
    return handleResponse(res);
  },

  deleteCompany: async (id: number): Promise<void> => {
    const res = await fetch(`${API_URL}/companies/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    return handleResponse(res);
  },

  // Tasks (Kanban)
  syncTasks: async (): Promise<Task[]> => {
    const res = await fetch(`${API_URL}/tasks/sync`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  getTasks: async (): Promise<Task[]> => {
    const res = await fetch(`${API_URL}/tasks`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  saveTask: async (task: Partial<Task>): Promise<{ success: boolean; id: number }> => {
    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(task),
    });
    return handleResponse(res);
  },

  deleteTask: async (id: number): Promise<void> => {
    const res = await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    return handleResponse(res);
  },

  // Document Status
  getDocumentStatuses: async (competence: string): Promise<any[]> => {
    const res = await fetch(`${API_URL}/documents/status?competence=${competence}`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  updateDocumentStatus: async (companyId: number, category: string, competence: string, status: string): Promise<void> => {
    const res = await fetch(`${API_URL}/documents/status`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ companyId, category, competence, status }),
    });
    return handleResponse(res);
  },

  // Upload Real
  uploadFile: async (file: File): Promise<{ filename: string; originalName: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
    });
    return handleResponse(res);
  },

  notifyWebhook: async (payload: { serverFilename: string, originalName: string, dueDate: string, category: string, companyId: string | number, competence?: string }): Promise<any> => {
    const res = await fetch(`${API_URL}/notify-webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
             ...getAuthHeader()
        },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  // Send Documents Real
  sendDocuments: async (payload: { documents: any[], subject: string, messageBody: string, channels: any, emailSignature?: string, whatsappTemplate?: string, whatsappFileSignature?: string, isBulk?: boolean }): Promise<any> => {
    const res = await fetch(`${API_URL}/send-documents`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  // progresso de um envio em massa (isBulk) — o POST devolve { jobId, total }
  getSendJobStatus: async (jobId: string): Promise<{
    id: string; status: 'running' | 'done' | 'canceled' | 'error';
    total: number; done: number; sent: number; skipped: number;
    errors: string[]; currentName: string | null; startedAt: number; finishedAt: number | null;
  }> => {
    const res = await fetch(`${API_URL}/send-documents/status/${encodeURIComponent(jobId)}`, { headers: getAuthHeader() });
    return handleResponse(res);
  },
  cancelSendJob: async (jobId: string): Promise<{ success: boolean }> => {
    const res = await fetch(`${API_URL}/send-documents/cancel/${encodeURIComponent(jobId)}`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },

  // Dashboard Data
  getRecentSends: async (): Promise<any[]> => {
    const res = await fetch(`${API_URL}/recent-sends`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  getFileGallery: async (): Promise<any[]> => {
    const res = await fetch(`${API_URL}/file-gallery`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  deleteFileGallery: async (id: number): Promise<void> => {
    const res = await fetch(`${API_URL}/file-gallery/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    return handleResponse(res);
  },

  // WhatsApp
  getWhatsAppStatus: async (): Promise<{ status: string; qr: string | null; info?: any }> => {
    const res = await fetch(`${API_URL}/whatsapp/status`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  disconnectWhatsApp: async (): Promise<void> => {
    const res = await fetch(`${API_URL}/whatsapp/disconnect`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },

  resetWhatsAppSession: async (): Promise<void> => {
    const res = await fetch(`${API_URL}/whatsapp/reset`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },

  getWhatsAppChats: async (): Promise<any[]> => {
    const res = await fetch(`${API_URL}/whatsapp/chats`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  getWhatsAppChatInfo: async (chatId: string): Promise<any> => {
    const res = await fetch(`${API_URL}/whatsapp/chat-info/${encodeURIComponent(chatId)}`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  getWhatsAppMessages: async (chatId: string, limit: number = 50): Promise<any[]> => {
    const res = await fetch(`${API_URL}/whatsapp/messages/${encodeURIComponent(chatId)}?limit=${limit}`, { headers: getAuthHeader() });
    return handleResponse(res);
  },

  sendWhatsAppChat: async (payload: { chatId: string, message?: string, media?: File }): Promise<any> => {
    const formData = new FormData();
    formData.append('chatId', payload.chatId);
    if (payload.message) formData.append('message', payload.message);
    if (payload.media) formData.append('media', payload.media);
    
    const headers = getAuthHeader();
    const res = await fetch(`${API_URL}/whatsapp/send-chat`, {
        method: 'POST',
        headers,
        body: formData
    });
    return handleResponse(res);
  },

  downloadWhatsAppMedia: async (msgId: string): Promise<Blob> => {
    const res = await fetch(`${API_URL}/whatsapp/media/${encodeURIComponent(msgId)}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Falha ao baixar mídia");
    return res.blob();
  },

  transcribeWhatsAppAudio: async (msgId: string): Promise<{ transcription: string }> => {
    const res = await fetch(`${API_URL}/whatsapp/transcribe/${encodeURIComponent(msgId)}`, { method: 'POST', headers: getAuthHeader() });
    return handleResponse(res);
  },

  getWhatsAppContact: async (number: string): Promise<{ id: string, name: string, isGroup: boolean }> => {
    const res = await fetch(`${API_URL}/whatsapp/contact`, { 
        method: 'POST', 
        headers: getHeaders(),
        body: JSON.stringify({ number })
    });
    return handleResponse(res);
  },

  // Scheduled Messages
  getScheduledMessages: async (): Promise<ScheduledMessage[]> => {
      const res = await fetch(`${API_URL}/scheduled`, { headers: getAuthHeader() });
      return handleResponse(res);
  },

  saveScheduledMessage: async (msg: Partial<ScheduledMessage>): Promise<{ success: boolean; id: number }> => {
      const res = await fetch(`${API_URL}/scheduled`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(msg)
      });
      return handleResponse(res);
  },

  deleteScheduledMessage: async (id: number): Promise<void> => {
      const res = await fetch(`${API_URL}/scheduled/${id}`, { method: 'DELETE', headers: getAuthHeader() });
      return handleResponse(res);
  }
};