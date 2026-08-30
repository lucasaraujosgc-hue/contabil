import React, { useState, useEffect, useRef } from 'react';
import { 
  Building2, CheckCircle2, Clock, AlertCircle, Loader2, Bot, Power, User, Trash2,
  Plus, MoreHorizontal, MessageCircle, Settings, X, Search, Phone, Send, Mic, 
  Paperclip, Music, FileText, Image as ImageIcon, RefreshCw, History, Download, Calendar
} from 'lucide-react';
import { UserSettings, WaKanbanState, WaKanbanColumn, WaKanbanTag, WaKanbanCard } from '../types';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';

// Helper: resolve display label for a chatId
// If chatId starts with 55<digits>@c.us → show formatted phone number
// Otherwise use the provided name (LID or name)
const getContactDisplayLabel = (chatId: string, name: string): string => {
  if (!chatId) return name || 'Desconhecido';
  const phoneMatch = chatId.match(/^(55\d{10,11})@c\.us$/);
  if (phoneMatch) {
    const digits = phoneMatch[1]; // e.g. 5575999999999
    // Format: +55 (75) 99999-9999
    const ddi = digits.slice(0, 2);   // 55
    const ddd = digits.slice(2, 4);   // 75
    const rest = digits.slice(4);
    const formatted = rest.length === 9
      ? `+${ddi} (${ddd}) ${rest.slice(0,5)}-${rest.slice(5)}`
      : `+${ddi} (${ddd}) ${rest.slice(0,4)}-${rest.slice(4)}`;
    // If name is the same as raw digits or looks like a LID, prefer formatted phone
    if (!name || name === digits || name.includes('@') || /^\d+$/.test(name)) {
      return formatted;
    }
    return name; // has a real name, use it
  }
  return name || chatId.split('@')[0] || 'Desconhecido';
};


interface Props {
  userSettings: UserSettings;
  onSaveSettings: (s: UserSettings) => void;
}

const Dashboard: React.FC<Props> = ({ userSettings, onSaveSettings }) => {
  const [loading, setLoading] = useState(true);
  const [waChats, setWaChats] = useState<any[]>([]);
  const [contactNumber, setContactNumber] = useState('');
  const [aiEnabled, setAiEnabled] = useState<boolean>(
    userSettings.aiEnabled !== false
  );
  
  // Modals
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<File[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [transcribingMap, setTranscribingMap] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [tagMenuCardId, setTagMenuCardId] = useState<string | null>(null);
  const [chatDetailsMap, setChatDetailsMap] = useState<Record<string, { profilePicUrl?: string | null, lastMessage?: string, lastMessageFromMe?: boolean, name?: string, number?: string | null }>>({});
  const [expandedMediaUrl, setExpandedMediaUrl] = useState<string | null>(null);
  const [expandedMediaType, setExpandedMediaType] = useState<'image' | 'video' | 'document' | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, { synced: boolean; lastSync: number | null; messageCount: number }>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState<Record<string, boolean>>({});
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  const [dashTasks, setDashTasks] = useState<any[]>([]);
  const [dashTasksLoading, setDashTasksLoading] = useState(false);
  
  const [taskFilterDate, setTaskFilterDate] = useState('');
  const [taskFilterPriority, setTaskFilterPriority] = useState('');
  const [taskFilterTime, setTaskFilterTime] = useState('');
  const [taskFilterName, setTaskFilterName] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [taskSort, setTaskSort] = useState('createdAt_desc');
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskNotes, setNewTaskNotes] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('');
  const [addingSubtaskTo, setAddingSubtaskTo] = useState<number | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const kanbanState: WaKanbanState = userSettings.waKanban || { columns: [], tags: [], cards: [] };

  const handleToggleAI = async () => {
    const newValue = !aiEnabled;
    setAiEnabled(newValue);
    const newSettings = { ...userSettings, aiEnabled: newValue };
    try {
      await api.saveSettings(newSettings);
      onSaveSettings(newSettings);
    } catch (e) {
      setAiEnabled(!newValue); // reverter em caso de erro
    }
  };

  const loadWaChats = async () => {
    try {
      const chats = await api.getWhatsAppChats();
      setWaChats(chats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadDashTasks = async () => {
    setDashTasksLoading(true);
    try {
        const t = await api.getTasks();
        setDashTasks(t);
    } catch (e) {
        console.error(e);
    } finally {
        setDashTasksLoading(false);
    }
  };

  const handleSyncTasks = async () => {
    setDashTasksLoading(true);
    try {
        const t = await api.syncTasks();
        setDashTasks(t);
    } catch (e) {
        console.error(e);
    } finally {
        setDashTasksLoading(false);
    }
  };

  const handleCreateSubtask = async (parentId: number, e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!newSubtaskTitle) return;
      setDashTasksLoading(true);
      try {
          const newTask = {
              title: newSubtaskTitle,
              description: '',
              status: 'pendente' as const,
              priority: 'media' as const,
              color: 'bg-slate-100',
              parentId: parentId
          };
          const res = await api.saveTask(newTask);
          if (res.success) {
              setNewSubtaskTitle('');
              setAddingSubtaskTo(null);
              await fetchDashTasks();
          }
      } catch (err) {
          console.error(err);
      } finally {
          setDashTasksLoading(false);
      }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTaskTitle) return;
      setDashTasksLoading(true);
      try {
          const newTask = {
              title: newTaskTitle,
              description: newTaskNotes,
              dueDate: newTaskDue,
              estimatedTime: newTaskTime,
              status: 'pendente' as const,
              priority: 'media' as const,
              color: 'bg-slate-100'
          };
          const res = await api.saveTask(newTask);
          if (res.success) {
              setNewTaskTitle('');
              setNewTaskNotes('');
              setNewTaskDue('');
              setNewTaskTime('');
              setShowAddTask(false);
              loadDashTasks(); 
          }
      } catch (err) {
          console.error(err);
      } finally {
          setDashTasksLoading(false);
      }
  };

  useEffect(() => {
      if (isTasksDrawerOpen) {
          loadDashTasks();
      }
  }, [isTasksDrawerOpen]);

  const activeChatRef = useRef(activeChat);
  useEffect(() => {
      activeChatRef.current = activeChat;
  }, [activeChat]);

  // SSE Handler corrigido
  useEffect(() => {
    loadWaChats();

    const token = localStorage.getItem('cm_auth_token');
    const es = new EventSource(`/api/whatsapp/events?token=${token}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'whatsapp_message') {
          const msg = data.payload;
          const chatId = msg.fromMe ? msg.to : msg.from;
          const isMedia = msg.hasMedia || msg.type === 'image' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'document';
          const previewText = msg.body || (isMedia ? '[Mídia]' : '');

          // Atualizar preview do card no kanban
          setChatDetailsMap(prev => ({
            ...prev,
            [chatId]: {
              ...prev[chatId],
              lastMessage: previewText,
              lastMessageFromMe: msg.fromMe,
            }
          }));

          // Atualizar lista de chats
          setWaChats(prev => {
            const idx = prev.findIndex(c => (c.id._serialized || c.id) === chatId);
            if (idx >= 0) {
              const newChats = [...prev];
              newChats[idx] = {
                ...newChats[idx],
                unreadCount: msg.fromMe ? 0 : (newChats[idx].unreadCount + 1),
                timestamp: msg.timestamp
              };
              return newChats.sort((a, b) => b.timestamp - a.timestamp);
            }
            loadWaChats();
            return prev;
          });

          // Adicionar mensagem na conversa ativa
          const currentActiveChat = activeChatRef.current;
          if (currentActiveChat) {
            const currentChatId = currentActiveChat.id._serialized || currentActiveChat.id;
            if (chatId === currentChatId) {
              const formattedMsg = {
                id: { _serialized: msg.id, id: msg.id },
                from: msg.from,
                to: msg.to,
                body: msg.body,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                type: msg.type,
                fromMe: msg.fromMe,
              };

              setChatMessages(prev => {
                const already = prev.some(m => {
                  const mId = m.id?._serialized || m.id?.id || m.id;
                  return mId === msg.id;
                });
                if (already) return prev;
                return [...prev, formattedMsg];
              });
              setTimeout(scrollToBottom, 100);
            }
          }
        }
      } catch (e) {
        console.error('[SSE] Erro ao processar evento:', e);
      }
    };

    es.onerror = () => {
      console.warn('[SSE] Conexão perdida, tentando reconectar...');
    };

    return () => { es.close(); };
  }, []);

  const firstColId = kanbanState.columns[0]?.id;
  let mergedCards = waChats.map(chat => {
      const chatId = typeof chat.id === 'object' ? chat.id._serialized : chat.id;
      const existingCard = kanbanState.cards.find(c => c.id === chatId);
      const details = chatDetailsMap[chatId] || {};
      
      return {
          id: chatId || '',
          name: getContactDisplayLabel(chatId, details.name || chat.name || (typeof chat.id === 'object' ? chat.id.user : chat.id?.split('@')[0])),
          unreadCount: chat.unreadCount,
          lastMessage: details.lastMessage !== undefined ? details.lastMessage : chat.lastMessage,
          lastMessageFromMe: details.lastMessageFromMe !== undefined ? details.lastMessageFromMe : chat.lastMessageFromMe,
          profilePicUrl: details.profilePicUrl !== undefined ? details.profilePicUrl : chat.profilePicUrl,
          timestamp: chat.timestamp,
          colId: existingCard ? existingCard.colId : (firstColId || ''),
          tagIds: existingCard ? existingCard.tagIds : []
      };
  });

  const mergedIds = new Set(mergedCards.map(c => c.id));
  kanbanState.cards.forEach(card => {
      if (!mergedIds.has(card.id)) {
          const details = chatDetailsMap[card.id] || {};
          mergedCards.push({
              id: card.id,
              name: getContactDisplayLabel(card.id, details.name || card.name || card.id.split('@')[0]),
              unreadCount: 0,
              lastMessage: details.lastMessage || '',
              lastMessageFromMe: details.lastMessageFromMe || false,
              profilePicUrl: details.profilePicUrl || null,
              timestamp: 0,
              colId: card.colId || (firstColId || ''),
              tagIds: card.tagIds || []
          });
      }
  });

  const filteredCards = mergedCards.filter(card => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      
      const safeName = card.name || '';
      const safeId = card.id || '';
      
      if (safeName.toLowerCase().includes(term)) return true;
      if (safeId.toLowerCase().includes(term)) return true;
      
      const hasMatchingTag = card.tagIds.some(tid => {
          const tag = kanbanState.tags.find(t => t.id === tid);
          return tag && (tag.name || '').toLowerCase().includes(term);
      });
      return hasMatchingTag;
  });

  useEffect(() => {
     const fetchMissingInfo = async () => {
         const missingIds = mergedCards
             .map(c => c.id)
             .filter(id => !chatDetailsMap[id] || chatDetailsMap[id].profilePicUrl === undefined);

         if (missingIds.length === 0) return;

         for (const id of missingIds) {
             setChatDetailsMap(prev => ({ ...prev, [id]: { ...(prev[id] || {}), profilePicUrl: null } }));
             try {
                 const info = await api.getWhatsAppChatInfo(id);
                 setChatDetailsMap(prev => ({
                     ...prev,
                     [id]: {
                         profilePicUrl: info.profilePicUrl,
                         lastMessage: info.lastMessage || prev[id]?.lastMessage,
                         lastMessageFromMe: info.lastMessageFromMe !== undefined ? info.lastMessageFromMe : prev[id]?.lastMessageFromMe,
                         name: info.pushname || prev[id]?.name,
                         number: info.number || prev[id]?.number
                     }
                 }));
             } catch(e) {}
         }
     };

     if (mergedCards.length > 0) {
         fetchMissingInfo();
     }
  }, [waChats, kanbanState.cards]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const chatId = e.dataTransfer.getData("chatId");
    if (!chatId) return;

    const newCards = [...kanbanState.cards];
    const cardIdx = newCards.findIndex(c => c.id === chatId);
    if (cardIdx >= 0) {
        newCards[cardIdx].colId = colId;
    } else {
        newCards.push({ id: chatId, colId, tagIds: [], name: '' });
    }
    
    await updateKanbanState({ ...kanbanState, cards: newCards });
  };

  const updateKanbanState = async (newState: WaKanbanState) => {
      const newSettings = { ...userSettings, waKanban: newState };
      try {
          await api.saveSettings(newSettings);
          onSaveSettings(newSettings);
      } catch (e) {}
  };

  const handleSyncAllKanbanContacts = async () => {
    if (isSyncingAll) return;
    
    const input = window.prompt('Quantos dias de histórico deseja varrer para TODOS os contatos do Kanban? (ex: 90, 180, 365)', '90');
    if (input === null) return;
    const days = parseInt(input.replace(/\D/g, ''), 10);
    if (!days || days <= 0) {
      alert('Digite um número de dias válido.');
      return;
    }

    if (!confirm(`Tem certeza que deseja buscar ${days} dias de mensagens para os ${kanbanState.cards.length} contatos do Kanban? Isso pode levar algum tempo.`)) {
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    
    try {
      const token = localStorage.getItem('cm_auth_token');
      for (let i = 0; i < kanbanState.cards.length; i++) {
        const card = kanbanState.cards[i];
        const chatId = card.id;
        
        try {
          const res = await fetch(`/api/whatsapp/load-history/${chatId}?days=${days}&force=true`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const result = await res.json();
          if (result.success) {
            successCount++;
            setHistoryLoaded(prev => ({ ...prev, [chatId]: true }));
            checkSyncStatus(chatId);
          }
        } catch (e) {
          console.error(`Erro ao sincronizar ${card.name}:`, e);
        }
        
        // Small delay to avoid overwhelming the server/whatsapp connection
        await new Promise(r => setTimeout(r, 1000));
      }
      
      alert(`Sincronização concluída! ${successCount} de ${kanbanState.cards.length} contatos atualizados.`);
      
      // Reload current chat if it's open
      if (activeChat) {
          const activeId = activeChat.id._serialized || activeChat.id;
          const msgs = await loadMessagesFromDb(activeId);
          setChatMessages(msgs);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao sincronizar contatos.');
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleLoadContact = async () => {
      if (!contactNumber) return;
      try {
          setLoading(true);
          const contact = await api.getWhatsAppContact(contactNumber);
          if (contact) {
              const newCardId = contact.id;
              
              const existsInKanban = kanbanState.cards.find(c => c.id === newCardId);
              if (!existsInKanban) {
                  const newCard: WaKanbanCard = { 
                      id: newCardId, 
                      tagIds: [], 
                      colId: kanbanState.columns[0]?.id || '',
                      name: contact.name || newCardId.split('@')[0]
                  };
                  await updateKanbanState({ ...kanbanState, cards: [...kanbanState.cards, newCard] });
              }

              setWaChats(prev => {
                  if (prev.find(c => c.id._serialized === newCardId)) return prev;
                  return [{
                      id: { _serialized: newCardId, user: newCardId.split('@')[0] },
                      name: contact.name || newCardId.split('@')[0],
                      unreadCount: 0,
                      timestamp: Date.now() / 1000,
                      isGroup: contact.isGroup
                  }, ...prev];
              });
          }
      } catch (e) {
          alert('Erro ao carregar contato');
      } finally {
          setLoading(false);
          setContactNumber('');
      }
  };

  const [msgLimit, setMsgLimit] = useState(50);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView();
  };

  // Função para carregar mensagens do banco
  const loadMessagesFromDb = async (chatId: string, before?: number): Promise<any[]> => {
    const token = localStorage.getItem('cm_auth_token');
    const url = before
      ? `/api/whatsapp/messages-db/${encodeURIComponent(chatId)}?limit=50&before=${before}`
      : `/api/whatsapp/messages-db/${encodeURIComponent(chatId)}?limit=50`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Falha ao carregar mensagens do banco');
    return res.json();
  };

  const checkSyncStatus = async (chatId: string) => {
    const token = localStorage.getItem('cm_auth_token');
    const res = await fetch(`/api/whatsapp/sync-status/${chatId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const status = await res.json();
      setSyncStatus(prev => ({ ...prev, [chatId]: status }));
      return status;
    }
    return null;
  };

  // openChat corrigido - carrega do banco
  const openChat = async (cardItem: any) => {
    const chatId = cardItem.id;
    setActiveChat({ id: { _serialized: chatId }, name: cardItem.name });
    setChatLoading(true);
    setMsgLimit(50);

    try {
      const msgs = await loadMessagesFromDb(chatId);
      setChatMessages(msgs);
      setTimeout(scrollToBottom, 100);
      checkSyncStatus(chatId);
    } catch (e) {
      console.error('[openChat] Erro ao carregar do banco:', e);
      setChatMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  // loadMoreMessages corrigido - scroll infinito
  const loadMoreMessages = async () => {
    if (!activeChat || chatLoading) return;
    setChatLoading(true);

    try {
      const chatId = activeChat.id._serialized || activeChat.id;

      const oldestTimestamp = chatMessages.length > 0
        ? Math.min(...chatMessages.map(m => m.timestamp))
        : undefined;

      const olderMsgs = await loadMessagesFromDb(chatId, oldestTimestamp);

      if (olderMsgs.length > 0) {
        const container = document.querySelector('[data-chat-container]');
        const scrollHeightBefore = container?.scrollHeight || 0;

        setChatMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id?._serialized || m.id?.id));
          const newMsgs = olderMsgs.filter(m => {
            const id = m.id?._serialized || m.id?.id;
            return !existingIds.has(id);
          });
          return [...newMsgs, ...prev];
        });

        setTimeout(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - scrollHeightBefore;
          }
        }, 50);
      } else {
        // Banco local esgotado: busca de fato mais para trás direto no WhatsApp
        // (sem corte de dias), a partir da mensagem mais antiga já conhecida.
        // Isso avança pulando períodos sem conversa (ex: se a última mensagem
        // carregada foi de 3 meses atrás, procura o próximo bloco existente,
        // seja de 6 meses, 1 ano, etc.)
        const oldestMsg = chatMessages.reduce(
          (o, m) => (m.timestamp < o.timestamp ? m : o),
          chatMessages[0]
        );
        const beforeId = oldestMsg?.id?._serialized || oldestMsg?.id?.id || null;

        const token = localStorage.getItem('cm_auth_token');
        const res = await fetch(`/api/whatsapp/fetch-older/${encodeURIComponent(chatId)}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ beforeId })
        });
        const result = await res.json().catch(() => null);

        if (result?.count > 0) {
          const container = document.querySelector('[data-chat-container]');
          const scrollHeightBefore = container?.scrollHeight || 0;

          const refreshed = await loadMessagesFromDb(chatId, oldestMsg?.timestamp);
          setChatMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id?._serialized || m.id?.id));
            const newMsgs = refreshed.filter(m => {
              const id = m.id?._serialized || m.id?.id;
              return !existingIds.has(id);
            });
            return [...newMsgs, ...prev];
          });

          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - scrollHeightBefore;
            }
          }, 50);
        } else if (result?.exhausted) {
          alert('Não há mensagens mais antigas nesta conversa.');
        }
      }
    } catch (e) {
      console.error('[loadMoreMessages] Erro:', e);
    } finally {
      setChatLoading(false);
    }
  };

  // Carregar histórico com quantidade de dias escolhida pelo usuário (sem limite fixo)
  const loadHistoryCustomDays = async () => {
    if (!activeChat || isLoadingHistory) return;

    const input = window.prompt('Quantos dias de histórico deseja varrer? (ex: 90, 180, 365)', '90');
    if (input === null) return; // usuário cancelou

    const days = parseInt(input.replace(/\D/g, ''), 10);
    if (!days || days <= 0) {
      alert('Digite um número de dias válido.');
      return;
    }

    const chatId = activeChat.id._serialized || activeChat.id;

    setIsLoadingHistory(true);
    try {
      const token = localStorage.getItem('cm_auth_token');
      const res = await fetch(`/api/whatsapp/load-history/${chatId}?days=${days}&force=true`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const result = await res.json();

      if (result.success) {
        alert(`✅ ${result.count} mensagens encontradas nos últimos ${days} dias!`);
        const msgs = await loadMessagesFromDb(chatId);
        setChatMessages(msgs);
        setTimeout(scrollToBottom, 100);
        setHistoryLoaded(prev => ({ ...prev, [chatId]: true }));
        checkSyncStatus(chatId);
      } else {
        alert('Erro ao recuperar mensagens: ' + (result.error || 'Tente novamente'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Carregar histórico de 45 dias
  const loadHistoryFrom45Days = async () => {
    if (!activeChat || isLoadingHistory) return;
    const chatId = activeChat.id._serialized || activeChat.id;

    setIsLoadingHistory(true);
    try {
      const token = localStorage.getItem('cm_auth_token');
      const res = await fetch(`/api/whatsapp/load-history/${chatId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const result = await res.json();

      if (result.already_synced) {
        alert(`Histórico já carregado anteriormente.\nÚltima sincronização: ${new Date(result.lastSync * 1000).toLocaleString('pt-BR')}`);
      } else if (result.success) {
        alert(`✅ ${result.count} mensagens carregadas com sucesso!`);
        const msgs = await loadMessagesFromDb(chatId);
        setChatMessages(msgs);
        setTimeout(scrollToBottom, 100);
        setHistoryLoaded(prev => ({ ...prev, [chatId]: true }));
        checkSyncStatus(chatId);
      } else {
        alert('Erro ao carregar histórico: ' + (result.error || 'Tente novamente'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // handleSendMessage corrigido com optimistic update
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessageText.trim() && selectedMedia.length === 0) || !activeChat || sendingMsg) return;

    const textToSend = newMessageText;
    const mediaToSend = [...selectedMedia];

    setSendingMsg(true);
    setNewMessageText('');
    setSelectedMedia([]);

    // Optimistic: uma bolha por arquivo + uma pelo texto (se houver)
    const optimisticMsgs = mediaToSend.map((file, i) => ({
      id: { _serialized: `optimistic_${Date.now()}_${i}`, id: `optimistic_${Date.now()}_${i}` },
      body: i === 0 ? textToSend : '',
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: true,
      type: file.type.startsWith('image') ? 'image' : 'document',
      hasMedia: true,
      _optimistic: true
    }));
    if (mediaToSend.length === 0 && textToSend.trim()) {
      optimisticMsgs.push({
        id: { _serialized: `optimistic_${Date.now()}`, id: `optimistic_${Date.now()}` },
        body: textToSend,
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: true,
        type: 'chat',
        hasMedia: false,
        _optimistic: true
      });
    }
    setChatMessages(prev => [...prev, ...optimisticMsgs]);
    setTimeout(scrollToBottom, 50);

    try {
      if (mediaToSend.length > 0) {
        // Envia cada arquivo; o texto vai junto no primeiro
        for (let i = 0; i < mediaToSend.length; i++) {
          await api.sendWhatsAppChat({
            chatId: activeChat.id._serialized,
            message: i === 0 ? textToSend : '',
            media: mediaToSend[i]
          });
        }
      } else {
        await api.sendWhatsAppChat({
          chatId: activeChat.id._serialized,
          message: textToSend,
          media: undefined
        });
      }
    } catch (e) {
      setChatMessages(prev => prev.filter(m => !m._optimistic));
      setNewMessageText(textToSend);
      setSelectedMedia(mediaToSend);
      alert('Erro ao enviar mensagem. Tente novamente.');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleTranscribe = async (msgId: string) => {
      setTranscribingMap(prev => ({...prev, [msgId]: true}));
      try {
          const res = await api.transcribeWhatsAppAudio(msgId);
          setChatMessages(prev => prev.map(m => {
              if (m.id.id === msgId || m.id._serialized === msgId) {
                  return { ...m, transcription: res.transcription };
              }
              return m;
          }));
      } catch (e) {
          alert('Erro ao transcrever');
      } finally {
          setTranscribingMap(prev => ({...prev, [msgId]: false}));
      }
  };

  const formatWaMarkdown = (text: string) => {
      if (!text) return "";
      let formatted = text.replace(/\*([^*_~]+)\*/g, '**$1**');
      formatted = formatted.replace(/_([^*_~]+)_/g, '*$1*');
      formatted = formatted.replace(/~([^*_~]+)~/g, '~~$1~~');
      return formatted;
  };

  if (loading && waChats.length === 0) {
      return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  const filteredDashTasks = dashTasks.filter(t => {
      if (t.parentId) return false;
      let match = true;
      if (!showCompletedTasks && t.status === 'concluida') match = false;
      if (taskFilterName && !t.title.toLowerCase().includes(taskFilterName.toLowerCase())) match = false;
      if (taskFilterDate && t.dueDate !== taskFilterDate) match = false;
      if (taskFilterPriority && t.priority !== taskFilterPriority) match = false;
      if (taskFilterTime && (!t.estimatedTime || !t.estimatedTime.toLowerCase().includes(taskFilterTime.toLowerCase()))) match = false;
      return match;
  }).sort((a, b) => {
      if (taskSort === 'createdAt_desc') {
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
      if (taskSort === 'createdAt_asc') {
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      if (taskSort === 'title_asc') {
          return a.title.localeCompare(b.title);
      }
      if (taskSort === 'priority_desc') {
          const pval = { alta: 3, media: 2, baixa: 1 };
          return (pval[b.priority as keyof typeof pval] || 0) - (pval[a.priority as keyof typeof pval] || 0);
      }
      if (taskSort === 'estimatedTime_asc') {
          const timeA = parseInt(a.estimatedTime || '0', 10) || 0;
          const timeB = parseInt(b.estimatedTime || '0', 10) || 0;
          return timeA - timeB;
      }
      return 0;
  });

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)', overflow: 'hidden' }}>
      {/* Toolbar compacta */}
      <div className="flex items-center gap-2 bg-white px-3 py-2 border-b border-gray-100 shrink-0 flex-wrap">
           <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
               <div className="pl-3 flex items-center justify-center text-gray-400">
                  <Search className="w-4 h-4" />
               </div>
               <input 
                  type="text"
                  placeholder="Pesquisar (Nome, n°, tag)..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="px-3 py-1.5 bg-transparent outline-none text-sm min-w-[180px]"
               />
           </div>
           <div className="flex bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
               <input 
                  type="text"
                  placeholder="Carregar Número (Ex: 55119)"
                  value={contactNumber}
                  onChange={e => setContactNumber(e.target.value)}
                  className="px-3 py-1.5 bg-transparent outline-none text-sm min-w-[180px]"
               />
               <button onClick={handleLoadContact} className="px-3 text-gray-600 hover:bg-gray-200 transition-colors">
                   <Phone className="w-4 h-4" />
               </button>
           </div>
           <button 
             onClick={() => setIsConfigModalOpen(true)}
             className="p-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
             title="Configurar Colunas e Tags"
           >
              <Settings className="w-5 h-5" />
           </button>
           <button 
             onClick={handleSyncAllKanbanContacts}
             className="p-1.5 border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50 transition-colors"
             title="Atualizar histórico de todos os contatos do Kanban"
           >
              {isSyncingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
           </button>
           <button
             onClick={handleToggleAI}
             title={aiEnabled ? 'IA Ativada — clique para desativar' : 'IA Desativada — clique para ativar'}
             className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
               aiEnabled
                 ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                 : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'
             }`}
           >
             <Bot className="w-4 h-4" />
             <span className="hidden sm:inline">IA {aiEnabled ? 'On' : 'Off'}</span>
             <span
               className={`w-2 h-2 rounded-full ${aiEnabled ? 'bg-green-500' : 'bg-gray-400'}`}
             />
           </button>
           
           <button
             onClick={() => setIsTasksDrawerOpen(true)}
             className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors text-xs font-semibold ml-auto"
           >
             <CheckCircle2 className="w-4 h-4" />
             <span>Tarefas</span>
           </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto flex gap-3 p-3">
          {kanbanState.columns.map(col => {
              const colCards = filteredCards.filter(c => c.colId === col.id);
              
              return (
                  <div 
                      key={col.id} 
                      className="flex-shrink-0 w-52 bg-gray-100 rounded-xl p-2 flex flex-col h-full overflow-hidden"
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, col.id)}
                  >
                      <div className="mb-2 pb-1.5 border-b-2 flex items-center justify-between" style={{ borderColor: col.color }}>
                          <h3 className="font-bold text-gray-700 flex items-center gap-1.5 text-xs">
                             {col.title}
                             <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">{colCards.length}</span>
                          </h3>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin">
                          {colCards.map(card => (
                              <div 
                                  key={card.id}
                                  draggable
                                  onDragStart={(e) => {
                                      e.dataTransfer.setData("chatId", card.id);
                                      e.dataTransfer.effectAllowed = "move";
                                  }}
                                  onClick={() => openChat(card)}
                                  className="bg-white p-2.5 rounded-lg shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all active:cursor-grabbing border-l-4 group"
                                  style={{ borderLeftColor: col.color }}
                              >
                                  <div className="flex items-center gap-2 mb-1.5">
                                      <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-200">
                                          {card.profilePicUrl ? (
                                              <img src={card.profilePicUrl} alt={card.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                          ) : (
                                              <User className="w-full h-full p-1.5 text-gray-400" />
                                          )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <div className="flex justify-between items-start">
                                              <h4 className="font-semibold text-gray-800 text-[11px] leading-tight truncate">{card.name}</h4>
                                              {card.unreadCount > 0 && (
                                                  <span className="bg-green-500 text-white text-[9px] px-1 py-px rounded-full font-bold ml-1">
                                                      {card.unreadCount}
                                                  </span>
                                              )}
                                          </div>
                                      </div>
                                  </div>

                                  <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1.5 truncate">
                                      {card.lastMessageFromMe && <CheckCircle2 className="w-3 h-3 text-blue-500 flex-shrink-0" />}
                                      <p className="truncate leading-tight">{card.lastMessage || 'Sem mensagem'}</p>
                                  </div>
                                  
                                  <div className="flex items-center justify-between mt-2">
                                      <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
                                          {card.tagIds.map(tid => {
                                              const tag = kanbanState.tags.find(t => t.id === tid);
                                              if (!tag) return null;
                                              return (
                                                <span key={tag.id} className="text-[9px] px-1.5 py-0.5 border rounded-full flex items-center gap-1 font-medium bg-gray-50 max-w-full truncate" style={{borderColor: tag.color, color: tag.color}}>
                                                    <div className="w-1 h-1 rounded-full" style={{backgroundColor: tag.color}}></div>
                                                    <span className="truncate">{tag.name}</span>
                                                </span>
                                              );
                                          })}
                                      </div>

                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                          <div className="relative">
                                              <button 
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      setTagMenuCardId(tagMenuCardId === card.id ? null : card.id);
                                                  }}
                                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                                  title="Adicionar Tag"
                                              >
                                                  <Plus className="w-4 h-4" />
                                              </button>
                                              
                                              {tagMenuCardId === card.id && (
                                                  <div className="absolute right-0 bottom-full mb-2 bg-white border border-gray-100 shadow-xl rounded-lg p-2 w-48 z-50 animate-in fade-in zoom-in duration-150" onClick={e => e.stopPropagation()}>
                                                      <div className="text-xs font-semibold text-gray-500 mb-2 px-1">Tags</div>
                                                      <div className="max-h-40 overflow-y-auto space-y-1 scrollbar-thin">
                                                          {kanbanState.tags.map(t => {
                                                              const hasTag = card.tagIds.includes(t.id);
                                                              return (
                                                                  <label key={t.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm transition-colors">
                                                                      <input type="checkbox" checked={!!hasTag} onChange={(e) => {
                                                                          const newCards = [...kanbanState.cards];
                                                                          let cIdx = newCards.findIndex(c => c.id === card.id);
                                                                          if(cIdx < 0) {
                                                                              newCards.push({ id: card.id, colId: col.id, tagIds: [], name: card.name });
                                                                              cIdx = newCards.length - 1;
                                                                          }
                                                                          let tags = newCards[cIdx].tagIds;
                                                                          if(e.target.checked) tags.push(t.id);
                                                                          else tags = tags.filter(id => id !== t.id);
                                                                          newCards[cIdx].tagIds = tags;
                                                                          updateKanbanState({...kanbanState, cards: newCards});
                                                                      }} className="rounded text-blue-600 focus:ring-blue-500"/>
                                                                      <div className="w-2 h-2 rounded-full" style={{backgroundColor: t.color}}></div>
                                                                      <span className="font-medium text-gray-700 truncate">{t.name}</span>
                                                                  </label>
                                                              );
                                                          })}
                                                          {kanbanState.tags.length === 0 && (
                                                              <div className="text-xs text-gray-400 p-1">Nenhuma tag criada</div>
                                                          )}
                                                      </div>
                                                  </div>
                                              )}
                                          </div>
                                          <button 
                                              onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (confirm('Remover esta conversa do Kanban?')) {
                                                      const newCards = kanbanState.cards.filter(c => c.id !== card.id);
                                                      updateKanbanState({...kanbanState, cards: newCards});
                                                  }
                                              }}
                                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                              title="Remover do Kanban"
                                          >
                                              <Trash2 className="w-4 h-4" />
                                          </button>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              );
          })}
          {kanbanState.columns.length === 0 && (
              <div className="flex items-center justify-center w-full h-40 text-gray-400">
                  <p>Nenhuma coluna configurada. Clique na engrenagem para adicionar.</p>
              </div>
          )}
      </div>

      {/* Kanban Config Modal */}
      {isConfigModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col items-center justify-center p-4">
              <div className="bg-white rounded-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><Settings className="w-5 h-5"/> Configurar Kanban</h3>
                      <button onClick={() => setIsConfigModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-8 flex-1">
                      {/* Columns Config */}
                      <div>
                          <h4 className="font-semibold text-gray-700 mb-3 border-b pb-2">Colunas</h4>
                          <div className="space-y-2">
                             {kanbanState.columns.map(col => (
                                 <div key={col.id} className="flex gap-2 items-center">
                                     <input type="color" value={col.color} onChange={e => {
                                         const newCols = kanbanState.columns.map(c => c.id === col.id ? {...c, color: e.target.value} : c);
                                         updateKanbanState({...kanbanState, columns: newCols});
                                     }} className="w-10 h-10 p-1 rounded cursor-pointer" />
                                     <input type="text" value={col.title} onChange={e => {
                                         const newCols = kanbanState.columns.map(c => c.id === col.id ? {...c, title: e.target.value} : c);
                                         updateKanbanState({...kanbanState, columns: newCols});
                                     }} className="flex-1 border rounded px-3 py-2 outline-none focus:border-blue-500" />
                                     <button onClick={() => {
                                         if(confirm('Excluir coluna?')) updateKanbanState({...kanbanState, columns: kanbanState.columns.filter(c => c.id !== col.id)});
                                     }} className="text-red-500 hover:bg-red-50 p-2 rounded">Excluir</button>
                                 </div>
                             ))}
                             <button onClick={() => {
                                 const newCols = [...kanbanState.columns, { id: 'col_'+Date.now(), title: 'Nova Coluna', color: '#cbd5e1' }];
                                 updateKanbanState({...kanbanState, columns: newCols});
                             }} className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-2 rounded flex items-center gap-1">
                                 <Plus className="w-4 h-4"/> Adicionar Coluna
                             </button>
                          </div>
                      </div>

                      {/* Tags Config */}
                      <div>
                          <h4 className="font-semibold text-gray-700 mb-3 border-b pb-2">Tags</h4>
                          <div className="space-y-2">
                             {kanbanState.tags.map(tag => (
                                 <div key={tag.id} className="flex gap-2 items-center">
                                     <input type="color" value={tag.color} onChange={e => {
                                         const newTags = kanbanState.tags.map(t => t.id === tag.id ? {...t, color: e.target.value} : t);
                                         updateKanbanState({...kanbanState, tags: newTags});
                                     }} className="w-10 h-10 p-1 rounded cursor-pointer" />
                                     <input type="text" value={tag.name} onChange={e => {
                                         const newTags = kanbanState.tags.map(t => t.id === tag.id ? {...t, name: e.target.value} : t);
                                         updateKanbanState({...kanbanState, tags: newTags});
                                     }} className="flex-1 border rounded px-3 py-2 outline-none focus:border-blue-500" />
                                     <button onClick={() => {
                                         if(confirm('Excluir tag?')) updateKanbanState({...kanbanState, tags: kanbanState.tags.filter(t => t.id !== tag.id)});
                                     }} className="text-red-500 hover:bg-red-50 p-2 rounded">Excluir</button>
                                 </div>
                             ))}
                             <button onClick={() => {
                                 const newTags = [...kanbanState.tags, { id: 'tag_'+Date.now(), name: 'Nova Tag', color: '#94a3b8' }];
                                 updateKanbanState({...kanbanState, tags: newTags});
                             }} className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-2 rounded flex items-center gap-1">
                                 <Plus className="w-4 h-4"/> Adicionar Tag
                             </button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Chat UI Modal */}
      {activeChat && (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col md:flex-row justify-end" onClick={() => setActiveChat(null)}>
              <div
                className="bg-white w-full md:w-[600px] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 relative"
                onClick={e => e.stopPropagation()}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
                onDrop={e => {
                  e.preventDefault();
                  setIsDragging(false);
                  const files = Array.from(e.dataTransfer.files);
                  if (files.length > 0) setSelectedMedia(prev => [...prev, ...files]);
                }}
              >
              {isDragging && (
                <div className="absolute inset-0 z-50 bg-blue-500/20 border-4 border-dashed border-blue-400 rounded flex items-center justify-center pointer-events-none">
                  <div className="bg-white rounded-xl px-8 py-6 shadow-lg flex flex-col items-center gap-2">
                    <Paperclip className="w-10 h-10 text-blue-500" />
                    <p className="text-blue-600 font-semibold text-lg">Solte para anexar</p>
                  </div>
                </div>
              )}
                  <div className="bg-slate-100 p-4 border-b flex items-center justify-between">
                      <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-600 overflow-hidden">
                              {chatDetailsMap[activeChat.id._serialized || activeChat.id]?.profilePicUrl ? (
                                  <img src={chatDetailsMap[activeChat.id._serialized || activeChat.id].profilePicUrl!} alt={activeChat.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                  <User className="w-5 h-5" />
                              )}
                          </div>
                          <div>
                              <h3 className="font-bold text-gray-800">{chatDetailsMap[activeChat.id._serialized || activeChat.id]?.name || activeChat.name}</h3>
                              <p className="text-xs text-gray-500">{chatDetailsMap[activeChat.id._serialized || activeChat.id]?.number ? `+${chatDetailsMap[activeChat.id._serialized || activeChat.id].number}` : (activeChat.id._serialized || activeChat.id)}</p>
                          </div>
                      </div>
                      <div className="flex items-center gap-3">
                           <div className="relative group">
                               <button className="text-gray-500 hover:text-gray-700 bg-white p-1.5 rounded-md border text-xs flex items-center gap-1">
                                  Tags
                               </button>
                               <div className="absolute right-0 top-full mt-1 bg-white border shadow-lg rounded-lg p-2 w-48 hidden group-hover:block z-50">
                                  {kanbanState.tags.map(t => {
                                      const cardInfo = kanbanState.cards.find(c => c.id === activeChat.id._serialized);
                                      const hasTag = cardInfo?.tagIds.includes(t.id);
                                      return (
                                          <label key={t.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 cursor-pointer text-sm">
                                              <input type="checkbox" checked={!!hasTag} onChange={(e) => {
                                                  const newCards = [...kanbanState.cards];
                                                  let cIdx = newCards.findIndex(c => c.id === activeChat.id._serialized);
                                                  if(cIdx < 0) {
                                                      newCards.push({ id: activeChat.id._serialized, colId: firstColId || '', tagIds: [], name: activeChat.name });
                                                      cIdx = newCards.length - 1;
                                                  }
                                                  let tags = newCards[cIdx].tagIds;
                                                  if(e.target.checked) tags.push(t.id);
                                                  else tags = tags.filter(id => id !== t.id);
                                                  newCards[cIdx].tagIds = tags;
                                                  updateKanbanState({...kanbanState, cards: newCards});
                                              }} />
                                              <span style={{color: t.color}} className="font-medium">{t.name}</span>
                                          </label>
                                      );
                                  })}
                               </div>
                           </div>
                           <button onClick={() => setActiveChat(null)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6"/></button>
                      </div>
                  </div>

                  <div
                    className="flex-1 overflow-y-auto p-4 space-y-4"
                    data-chat-container
                    style={{backgroundColor: '#efeae2', backgroundImage: `url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")`, backgroundRepeat: 'repeat', backgroundSize: '400px'}}
                  >
                      {chatLoading && chatMessages.length === 0 ? (
                          <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                      ) : (
                          <>
                              {/* Topo da conversa: controles de histórico */}
                              <div className="flex flex-col items-center gap-2 mb-3">

                                  {/* Carregar mais antigas do banco (sempre visível se há msgs) */}
                                  {chatMessages.length > 0 && (
                                      <button
                                          onClick={loadMoreMessages}
                                          disabled={chatLoading}
                                          className="text-sm bg-white/90 border border-gray-200 text-gray-600 px-4 py-1.5 rounded-full shadow-sm hover:bg-white flex items-center gap-2 transition-all disabled:opacity-50"
                                      >
                                          {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                          Carregar mais antigas
                                      </button>
                                  )}

                                  {/* Sincronizar com WhatsApp (45 dias) - sempre disponível */}
                                  <button
                                      onClick={loadHistoryFrom45Days}
                                      disabled={isLoadingHistory}
                                      className="text-sm bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-full shadow-md flex items-center gap-2 font-medium transition-all disabled:opacity-60"
                                  >
                                      {isLoadingHistory
                                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Sincronizando...</>
                                          : <><History className="w-4 h-4" /> {(historyLoaded[activeChat.id._serialized] || syncStatus[activeChat.id._serialized]?.synced) ? 'Atualizar histórico' : 'Carregar histórico (45 dias)'}</>
                                      }
                                  </button>

                                  {/* Recuperar mensagens: escolhe a quantidade de dias, sem limite fixo */}
                                  <button
                                      onClick={loadHistoryCustomDays}
                                      disabled={isLoadingHistory}
                                      className="text-sm bg-white/90 border border-gray-200 text-gray-600 px-4 py-1.5 rounded-full shadow-sm hover:bg-white flex items-center gap-2 transition-all disabled:opacity-50"
                                  >
                                      {isLoadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                      Recuperar mensagens
                                  </button>

                                  {/* Badge de última sync */}
                                  {(historyLoaded[activeChat.id._serialized] || syncStatus[activeChat.id._serialized]?.synced) && (
                                      <span className="text-[11px] bg-white/70 text-gray-400 px-3 py-0.5 rounded-full">
                                          ✅ Última sync:{' '}
                                          {syncStatus[activeChat.id._serialized]?.lastSync
                                              ? new Date(syncStatus[activeChat.id._serialized].lastSync! * 1000).toLocaleDateString('pt-BR')
                                              : 'recentemente'
                                          }
                                      </span>
                                  )}
                              </div>

                              {chatMessages.length === 0 && !chatLoading ? (
                                  <div className="flex flex-col items-center justify-center mt-6 gap-2">
                                      <div className="text-center text-gray-500 text-sm bg-white/90 py-3 px-5 rounded-xl shadow-sm inline-block">
                                          Nenhuma mensagem local. Clique em "Carregar histórico" acima.
                                      </div>
                                  </div>
                              ) : null}

                              {/* Mensagens */}
                              {(() => {
                                  let lastDateStr = '';
                                  const todayStr = new Date().toLocaleDateString('pt-BR');
                                  const yesterday = new Date();
                                  yesterday.setDate(yesterday.getDate() - 1);
                                  const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

                                  return chatMessages.map((msg, idx) => {
                                      const isMe = msg.fromMe;
                                      let msgTypeIcon = null;
                                      if(msg.type === 'image') msgTypeIcon = <ImageIcon className="w-4 h-4"/>;
                                      if(msg.type === 'document') msgTypeIcon = <FileText className="w-4 h-4"/>;
                                      if(msg.type === 'audio' || msg.type === 'ptt') msgTypeIcon = <Music className="w-4 h-4"/>;

                                      const msgIdStr = msg.id?.id || msg.id?._serialized;
                                      const isOptimistic = msg._optimistic;

                                      const msgDateStr = new Date(msg.timestamp * 1000).toLocaleDateString('pt-BR');
                                      const showDateSeparator = msgDateStr !== lastDateStr;
                                      lastDateStr = msgDateStr;
                                      
                                      let dateLabel = msgDateStr;
                                      if (msgDateStr === todayStr) dateLabel = 'HOJE';
                                      else if (msgDateStr === yesterdayStr) dateLabel = 'ONTEM';

                                      return (
                                          <React.Fragment key={msgIdStr || idx}>
                                              {showDateSeparator && (
                                                  <div className="flex justify-center my-3">
                                                      <span className="bg-[#e1f3fb] text-gray-600 text-xs font-medium px-3 py-1 rounded-md shadow-sm border border-gray-200/50">
                                                          {dateLabel}
                                                      </span>
                                                  </div>
                                              )}
                                              <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                                  <div className={`max-w-[80%] rounded-xl p-3 shadow-sm ${isMe ? 'bg-green-100 rounded-tr-none' : 'bg-white rounded-tl-none border border-gray-100'} ${isOptimistic ? 'opacity-70' : ''}`}>
                                              {msgTypeIcon && (
                                                  <div className="flex flex-col gap-2 mb-1 border-b border-black/5 pb-1">
                                                      <div className="flex items-center gap-2 text-gray-500">
                                                          {msgTypeIcon}
                                                          <span className="text-xs font-semibold">{msg.type?.toUpperCase()}</span>
                                                          
                                                          {(msg.type === 'audio' || msg.type === 'ptt') && !msg.transcription && msgIdStr && !isOptimistic && (
                                                              <button 
                                                                onClick={() => handleTranscribe(msgIdStr)}
                                                                disabled={transcribingMap[msgIdStr]}
                                                                className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-100 flex items-center min-w-[90px] justify-center"
                                                              >
                                                                  {transcribingMap[msgIdStr] ? <Loader2 className="w-3 h-3 animate-spin" /> : 'IA: Transcrever'}
                                                              </button>
                                                          )}
                                                      </div>
                                                      {(msg.type === 'audio' || msg.type === 'ptt') && msgIdStr && !isOptimistic && (
                                                          <audio 
                                                              controls 
                                                              className="mt-1 h-10 w-full max-w-[240px]" 
                                                              src={`/api/whatsapp/media/${msgIdStr}?token=${localStorage.getItem('cm_auth_token')}`}
                                                              preload="metadata"
                                                          />
                                                      )}
                                                      {(msg.type === 'image' || msg.type === 'video') && msgIdStr && !isOptimistic && (
                                                          <img 
                                                              src={`/api/whatsapp/media/${msgIdStr}?token=${localStorage.getItem('cm_auth_token')}`} 
                                                              alt="Media" 
                                                              className="mt-2 rounded-lg max-h-[200px] object-cover cursor-pointer hover:opacity-90 border border-gray-200" 
                                                              onClick={() => {
                                                                  setExpandedMediaUrl(`/api/whatsapp/media/${msgIdStr}?token=${localStorage.getItem('cm_auth_token')}`);
                                                                  setExpandedMediaType(msg.type as 'image' | 'video');
                                                              }}
                                                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                              loading="lazy"
                                                          />
                                                      )}
                                                      {msg.type === 'document' && msgIdStr && !isOptimistic && (() => {
                                                          // No whatsapp-web.js, msg.body para documents é o filename original
                                                          const docFilename = (msg.body && msg.body.includes('.'))
                                                              ? msg.body
                                                              : `documento_${new Date(msg.timestamp * 1000).toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`;
                                                          return (
                                                          <div className="flex gap-2 mt-2">
                                                              <button 
                                                                  onClick={() => {
                                                                      setExpandedMediaUrl(`/api/whatsapp/media/${msgIdStr}?token=${localStorage.getItem('cm_auth_token')}`);
                                                                      setExpandedMediaType('document');
                                                                  }}
                                                                  className="flex-1 flex items-center justify-center p-2 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 text-blue-700 text-sm font-medium transition-colors gap-1"
                                                              >
                                                                  <FileText className="w-4 h-4" />
                                                                  <span className="truncate max-w-[120px]" title={docFilename}>
                                                                      {docFilename}
                                                                  </span>
                                                              </button>
                                                              <a
                                                                  href={`/api/whatsapp/media/${msgIdStr}?token=${localStorage.getItem('cm_auth_token')}`}
                                                                  download={docFilename}
                                                                  className="flex items-center justify-center p-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors"
                                                                  title={`Baixar: ${docFilename}`}
                                                              >
                                                                  <Download className="w-4 h-4" />
                                                              </a>
                                                          </div>
                                                          );
                                                      })()}
                                                  </div>
                                              )}
                                              
                                              {msg.body && msg.type !== 'document' && (
                                                  <div className="text-sm text-gray-800 break-words markdown-body whatsapp-md">
                                                      <ReactMarkdown>{formatWaMarkdown(msg.body)}</ReactMarkdown>
                                                  </div>
                                              )}

                                              {msg.transcription && (
                                                  <div className="mt-2 p-2 bg-blue-50 border-l-2 border-blue-500 text-sm text-gray-800 rounded">
                                                      <strong>Transcrição IA:</strong><br/>
                                                      <ReactMarkdown>{formatWaMarkdown(msg.transcription)}</ReactMarkdown>
                                                  </div>
                                              )}
                                              
                                              <div className={`text-[10px] text-right mt-1 ${isMe ? 'text-green-700/70' : 'text-gray-400'}`}>
                                                  {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                  {isOptimistic && ' ⏳'}
                                              </div>
                                          </div>
                                      </div>
                                    </React.Fragment>
                                  );
                              })})()}
                          </>
                      )}
                      
                      <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={handleSendMessage} className="p-3 bg-slate-100 border-t flex items-end gap-2">
                      {/* Input de arquivo fora do fluxo do form para evitar submit indevido */}
                      <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept="image/*,application/pdf,audio/*,video/*"
                          multiple
                          onChange={e => {
                              if (e.target.files && e.target.files.length > 0) {
                                  const files = Array.from(e.target.files);
                                  e.target.value = '';
                                  setSelectedMedia(prev => [...prev, ...files]);
                              } else {
                                  e.target.value = '';
                              }
                          }}
                      />
                      <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
                          {selectedMedia.length > 0 && (
                              <div className="bg-gray-50 p-2 border-b flex flex-wrap gap-1">
                                  {selectedMedia.map((file, i) => (
                                      <div key={i} className="flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 max-w-[180px]">
                                          <span className="truncate">{file.name}</span>
                                          <button
                                              type="button"
                                              onClick={() => setSelectedMedia(prev => prev.filter((_, j) => j !== i))}
                                              className="text-red-400 hover:text-red-600 shrink-0 ml-1"
                                          ><X className="w-3 h-3"/></button>
                                      </div>
                                  ))}
                              </div>
                          )}
                          <div className="flex items-end">
                              <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  className="p-3 text-gray-400 hover:text-gray-600 cursor-pointer"
                                  title="Anexar arquivo"
                              >
                                  <Paperclip className="w-5 h-5"/>
                              </button>
                              <textarea 
                                  value={newMessageText}
                                  onChange={e => setNewMessageText(e.target.value)}
                                  onKeyDown={e => {
                                      if(e.key === 'Enter' && !e.shiftKey) {
                                          e.preventDefault();
                                          handleSendMessage(e);
                                      }
                                  }}
                                  onPaste={e => {
                                      const items = e.clipboardData?.items;
                                      if (!items) return;
                                      for (const item of Array.from(items)) {
                                          if (item.type.startsWith('image/')) {
                                              const file = item.getAsFile();
                                              if (file) {
                                                  e.preventDefault();
                                                  // Renomeia para algo legível, ex: print_2024-01-01_14-30-00.png
                                                  const now = new Date();
                                                  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
                                                  const renamedFile = new File([file], `print_${timestamp}.png`, { type: file.type });
                                                  setSelectedMedia(prev => [...prev, renamedFile]);
                                              }
                                              break;
                                          }
                                      }
                                  }}
                                  placeholder="Digite uma mensagem..."
                                  className="flex-1 max-h-32 min-h-[44px] py-3 outline-none resize-none bg-transparent"
                                  rows={1}
                              />
                          </div>
                      </div>
                      <button 
                          type="submit"
                          disabled={sendingMsg || (!newMessageText.trim() && selectedMedia.length === 0)}
                          className="w-11 h-11 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
                      >
                          {sendingMsg ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1"/>}
                      </button>
                  </form>
              </div>
          </div>
      )}

      {expandedMediaUrl && (
          <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center animate-in fade-in duration-200">
              <button 
                  className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/80 rounded-full p-2 "
                  onClick={() => {
                      setExpandedMediaUrl(null);
                      setExpandedMediaType(null);
                  }}
              >
                  <X className="w-8 h-8" />
              </button>
              
              <div className="max-w-[90vw] max-h-[90vh] overflow-auto flex items-center justify-center">
                  {(expandedMediaType === 'image' || expandedMediaType === 'video') && (
                      <img src={expandedMediaUrl} className="max-w-full max-h-[90vh] object-contain rounded-lg" alt="Expanded Media" />
                  )}
                  {expandedMediaType === 'document' && (
                      <iframe src={expandedMediaUrl} className="w-[80vw] h-[80vh] bg-white rounded-lg" title="Document Viewer" />
                  )}
              </div>
          </div>
      )}

      {/* Drawer Lateral de Tarefas */}
      {isTasksDrawerOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/40" onClick={() => setIsTasksDrawerOpen(false)}></div>
              <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
                  <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                      <div className="flex items-center gap-2 text-gray-800">
                          <CheckCircle2 className="w-5 h-5 text-purple-600" />
                          <h2 className="font-bold">Minhas Tarefas</h2>
                      </div>
                      <div className="flex gap-2">
                          <button onClick={handleSyncTasks} className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-md transition" title="Sincronizar com Google">
                              <RefreshCw className={`w-4 h-4 ${dashTasksLoading ? 'animate-spin' : ''}`} />
                          </button>
                          <button onClick={() => setIsTasksDrawerOpen(false)} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md">
                              <X className="w-5 h-5" />
                          </button>
                      </div>
                  </div>

                  {/* Filtros e Ações */}
                  <div className="px-4 py-3 bg-white border-b border-gray-100 flex flex-col gap-3 shrink-0 shadow-sm z-10 relative">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                          <div className="flex gap-2 items-center">
                              <button 
                                  onClick={() => setShowFilters(!showFilters)}
                                  className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors ${showFilters ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                              >
                                  <Search className="w-3.5 h-3.5" /> {showFilters ? 'Ocultar Filtros' : 'Filtros e Ordenação'}
                              </button>
                          </div>
                          <button 
                              onClick={() => setShowAddTask(!showAddTask)}
                              className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors ${showAddTask ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                          >
                              {showAddTask ? <><X className="w-3.5 h-3.5" /> Cancelar</> : <><Plus className="w-3.5 h-3.5" /> Nova Tarefa</>}
                          </button>
                      </div>

                      {showFilters && (
                          <div className="grid grid-cols-2 gap-2 mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                              <div className="col-span-2 flex items-center gap-2 mb-1">
                                  <input 
                                      type="checkbox" 
                                      id="showCompleted" 
                                      checked={showCompletedTasks} 
                                      onChange={(e) => setShowCompletedTasks(e.target.checked)}
                                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                  />
                                  <label htmlFor="showCompleted" className="text-xs font-medium text-gray-700 cursor-pointer">
                                      Exibir tarefas concluídas
                                  </label>
                              </div>
                              <input type="text" placeholder="Buscar por título..." value={taskFilterName} onChange={e => setTaskFilterName(e.target.value)} className="col-span-2 text-xs p-1.5 border border-gray-200 rounded-md outline-none focus:border-purple-300" />
                              <input type="date" value={taskFilterDate} onChange={e => setTaskFilterDate(e.target.value)} className="text-xs p-1.5 border border-gray-200 rounded-md outline-none focus:border-purple-300" />
                              <select value={taskFilterPriority} onChange={e => setTaskFilterPriority(e.target.value)} className="text-xs p-1.5 border border-gray-200 rounded-md outline-none focus:border-purple-300">
                                  <option value="">Todas as prioridades</option>
                                  <option value="baixa">Baixa</option>
                                  <option value="media">Média</option>
                                  <option value="alta">Alta</option>
                              </select>
                              <div className="col-span-2 relative">
                                  <input type="number" placeholder="Tempo ex: 30" value={taskFilterTime} onChange={e => setTaskFilterTime(e.target.value)} className="w-full text-xs p-1.5 border border-gray-200 rounded-md outline-none focus:border-purple-300 pr-8" />
                                  <span className="absolute right-2 top-1.5 text-xs text-gray-400">min</span>
                              </div>
                              <select value={taskSort} onChange={e => setTaskSort(e.target.value)} className="col-span-2 mt-1 text-xs p-1.5 border border-gray-200 rounded-md outline-none focus:border-purple-300 bg-white">
                                  <option value="createdAt_desc">Data de criação (Mais recentes)</option>
                                  <option value="createdAt_asc">Data de criação (Mais antigas)</option>
                                  <option value="title_asc">Nome (A-Z)</option>
                                  <option value="priority_desc">Prioridade (Alta-Baixa)</option>
                                  <option value="estimatedTime_asc">Tempo para conclusão (Menor-Maior)</option>
                              </select>
                          </div>
                      )}
                  </div>

                  {/* Form de Nova Tarefa */}
                  {showAddTask && (
                      <form onSubmit={handleCreateTask} className="p-4 bg-purple-50/50 border-b border-purple-100 shrink-0">
                          <div className="space-y-3">
                              <div>
                                  <label className="text-xs font-medium text-gray-700 mb-1 block">Título da Tarefa</label>
                                  <input type="text" required value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-purple-400" placeholder="O que precisa ser feito?" />
                              </div>
                              <div>
                                  <label className="text-xs font-medium text-gray-700 mb-1 block">Detalhes (Opcional)</label>
                                  <textarea value={newTaskNotes} onChange={e => setNewTaskNotes(e.target.value)} rows={2} className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-purple-400 resize-none" placeholder="Adicione detalhes..."></textarea>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                  <div>
                                      <label className="text-xs font-medium text-gray-700 mb-1 block">Data de Conclusão</label>
                                      <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-purple-400" />
                                  </div>
                                  <div>
                                      <label className="text-xs font-medium text-gray-700 mb-1 block">Tempo Estimado (min)</label>
                                      <div className="relative">
                                          <input type="number" value={newTaskTime} onChange={e => setNewTaskTime(e.target.value)} placeholder="Ex: 30" className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-purple-400 pr-8" />
                                          <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-medium">min</span>
                                      </div>
                                  </div>
                              </div>
                              <div className="pt-2">
                                  <button type="submit" disabled={dashTasksLoading || !newTaskTitle} className="w-full bg-purple-600 text-white font-medium p-2 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center">
                                      {dashTasksLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar Tarefa'}
                                  </button>
                              </div>
                          </div>
                      </form>
                  )}

                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
                      {dashTasksLoading && dashTasks.length === 0 ? (
                          <div className="flex items-center justify-center p-8 text-gray-400">
                              <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                      ) : dashTasks.length === 0 ? (
                          <div className="text-center p-8 text-gray-400 text-sm">
                              Nenhuma tarefa encontrada.<br/>Clique em sincronizar para buscar do Google Tasks.
                          </div>
                      ) : filteredDashTasks.length === 0 ? (
                          <div className="text-center p-8 text-gray-400 text-sm">
                              Nenhuma tarefa corresponde aos filtros.
                          </div>
                      ) : (
                          filteredDashTasks.map(t => (
                              <div key={t.id} className={`p-3 bg-white border ${t.status === 'concluida' ? 'border-gray-200 opacity-60' : 'border-gray-300'} rounded-xl shadow-sm flex flex-col gap-2`}>
                                  <div className="flex items-start justify-between gap-2">
                                      <h3 className={`font-medium text-sm ${t.status === 'concluida' ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                                          {t.title}
                                      </h3>
                                      <div className="flex items-center gap-1 shrink-0">
                                          <button 
                                              onClick={async () => {
                                                  const newStatus = t.status === 'concluida' ? 'pendente' : 'concluida';
                                                  const updated = {...t, status: newStatus};
                                                  setDashTasks(prev => prev.map(pt => pt.id === t.id ? updated : pt));
                                                  await api.saveTask(updated);
                                              }}
                                              className={`p-1 rounded-md transition ${t.status === 'concluida' ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                                              title={t.status === 'concluida' ? 'Marcar como pendente' : 'Marcar como concluída'}
                                          >
                                              <CheckCircle2 className="w-4 h-4" />
                                          </button>
                                          <button 
                                              onClick={async () => {
                                                  if(confirm('Tem certeza que deseja excluir esta tarefa?')) {
                                                      setDashTasks(prev => prev.filter(pt => pt.id !== t.id));
                                                      await api.deleteTask(t.id);
                                                  }
                                              }}
                                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition"
                                              title="Excluir tarefa"
                                          >
                                              <Trash2 className="w-4 h-4" />
                                          </button>
                                      </div>
                                  </div>
                                  {t.description && (
                                      <p className="text-xs text-gray-500 line-clamp-2">{t.description}</p>
                                  )}
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                      {t.dueDate && (
                                          <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                              <Calendar className="w-3 h-3" /> {t.dueDate}
                                          </span>
                                      )}
                                      <select 
                                          value={t.priority || 'baixa'} 
                                          onChange={async (e) => {
                                              const newP = e.target.value;
                                              const updated = {...t, priority: newP};
                                              setDashTasks(prev => prev.map(pt => pt.id === t.id ? updated : pt));
                                              await api.saveTask(updated);
                                          }}
                                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full outline-none cursor-pointer border ${t.priority==='alta'?'bg-red-50 text-red-700 border-red-200':t.priority==='media'?'bg-yellow-50 text-yellow-700 border-yellow-200':'bg-blue-50 text-blue-700 border-blue-200'}`}
                                      >
                                          <option value="baixa">🔵 Baixa</option>
                                          <option value="media">🟡 Média</option>
                                          <option value="alta">🔴 Alta</option>
                                      </select>
                                      
                                      <div className="flex items-center gap-1 border rounded-full px-2 py-0.5 bg-gray-50 ml-auto">
                                          <Clock className="w-3 h-3 text-gray-400" />
                                          <div className="relative flex items-center">
                                              <input 
                                                  type="number" 
                                                  placeholder="Ex: 30" 
                                                  defaultValue={t.estimatedTime || ''}
                                                  onBlur={async (e) => {
                                                      const newT = e.target.value;
                                                      if (newT !== t.estimatedTime) {
                                                          const updated = {...t, estimatedTime: newT};
                                                          setDashTasks(prev => prev.map(pt => pt.id === t.id ? updated : pt));
                                                          await api.saveTask(updated);
                                                      }
                                                  }}
                                                  className="bg-transparent outline-none text-[10px] w-8 text-gray-600 placeholder-gray-400 text-center"
                                              />
                                              <span className="text-[10px] text-gray-400 font-medium">min</span>
                                          </div>
                                      </div>
                                  </div>
                                  
                                  {/* Subtasks */}
                                  <div className="pl-4 border-l-2 border-gray-100 mt-2 space-y-2">
                                      {dashTasks.filter(st => st.parentId === t.id).map(st => (
                                          <div key={st.id} className={`flex flex-col gap-1 ${st.status === 'concluida' ? 'opacity-60' : ''}`}>
                                              <div className="flex items-start justify-between gap-2">
                                                  <div className="flex items-center gap-2">
                                                      <button 
                                                          onClick={async () => {
                                                              const newStatus = st.status === 'concluida' ? 'pendente' : 'concluida';
                                                              const updated = {...st, status: newStatus};
                                                              setDashTasks(prev => prev.map(pt => pt.id === st.id ? updated : pt));
                                                              await api.saveTask(updated);
                                                          }}
                                                          className={`shrink-0 ${st.status === 'concluida' ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}
                                                      >
                                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                                      </button>
                                                      <span className={`text-xs ${st.status === 'concluida' ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                                                          {st.title}
                                                      </span>
                                                  </div>
                                                  <button 
                                                      onClick={async () => {
                                                          if(confirm('Tem certeza que deseja excluir esta subtarefa?')) {
                                                              setDashTasks(prev => prev.filter(pt => pt.id !== st.id));
                                                              await api.deleteTask(st.id);
                                                          }
                                                      }}
                                                      className="p-1 text-gray-300 hover:text-red-500 rounded-md transition"
                                                      title="Excluir subtarefa"
                                                  >
                                                      <X className="w-3 h-3" />
                                                  </button>
                                              </div>
                                          </div>
                                      ))}
                                      
                                      {addingSubtaskTo === t.id ? (
                                          <form onSubmit={(e) => handleCreateSubtask(t.id, e)} className="flex items-center gap-2 mt-2">
                                              <input 
                                                  type="text" 
                                                  autoFocus
                                                  value={newSubtaskTitle}
                                                  onChange={e => setNewSubtaskTitle(e.target.value)}
                                                  placeholder="Nova subtarefa..."
                                                  className="text-xs p-1 border border-gray-200 rounded outline-none focus:border-purple-300 flex-1"
                                              />
                                              <button type="submit" disabled={!newSubtaskTitle || dashTasksLoading} className="text-xs text-purple-600 font-medium hover:text-purple-700 disabled:opacity-50">
                                                  Adicionar
                                              </button>
                                              <button type="button" onClick={() => { setAddingSubtaskTo(null); setNewSubtaskTitle(''); }} className="text-xs text-gray-400 hover:text-gray-600">
                                                  Cancelar
                                              </button>
                                          </form>
                                      ) : (
                                          <button 
                                              onClick={() => { setAddingSubtaskTo(t.id); setNewSubtaskTitle(''); }}
                                              className="text-[10px] text-gray-400 hover:text-purple-600 font-medium flex items-center gap-1 mt-1"
                                          >
                                              <Plus className="w-3 h-3" /> Adicionar subtarefa
                                          </button>
                                      )}
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Dashboard;
