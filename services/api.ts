import { Company, Task, Document, UserSettings, ScheduledMessage } from '../types';

const API_URL = '/api';

const getHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('cm_auth_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
};

const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem('cm_auth_token');
    if (token) {
        return { 'Authorization': `Bearer ${token}` };
    }
    return {};
};

const handleResponse = async (res: Response) => {
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('cm_auth_token');
    window.location.href = '/'; 
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const contentType = res.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  } else {
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Erro ${res.status}`);
    return { success: true };
  }
};

export const api = {
  // Authenticationo
  login: async (user: string, pass: string): Promise<{ success: boolean; token?: string }> => {
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password: pass }),
      });
      return handleResponse(res);
    } catch (error) {
      console.error("Login failed", error);
      return { success: false };
    }
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
  sendDocuments: async (payload: { documents: any[], subject: string, messageBody: string, channels: any, emailSignature?: string, whatsappTemplate?: string, whatsappFileSignature?: string }): Promise<any> => {
    const res = await fetch(`${API_URL}/send-documents`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });
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