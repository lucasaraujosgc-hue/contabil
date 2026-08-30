import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Loader2, History, MessageSquare, Search, ChevronDown, ChevronRight } from 'lucide-react';

const BACKUP_KEY = 'cm_chat_backup';
const FAB_POS_KEY = 'cm_fab_position';
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

interface Message { role: 'user' | 'ai'; text: string; ts: number; }
interface DayGroup { date: string; label: string; messages: Message[]; }

const SimpleMarkdown: React.FC<{ text: string; highlight?: string }> = ({ text, highlight }) => {
  const renderLine = (line: string, idx: number) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={idx}>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
          if (highlight && part.toLowerCase().includes(highlight.toLowerCase())) {
            const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const chunks = part.split(re);
            return <span key={i}>{chunks.map((c, j) => re.test(c) ? <mark key={j} style={{background:'#fef08a',borderRadius:'2px',padding:'0 1px'}}>{c}</mark> : c)}</span>;
          }
          return <span key={i}>{part}</span>;
        })}
      </React.Fragment>
    );
  };
  return (
    <span>{text.split('\n').map((line, i, arr) => (
      <React.Fragment key={i}>{renderLine(line, i)}{i < arr.length - 1 && <br />}</React.Fragment>
    ))}</span>
  );
};

function loadBackup(): Message[] {
  try { const raw = localStorage.getItem(BACKUP_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function saveBackup(messages: Message[]) {
  try {
    let data = [...messages];
    let json = JSON.stringify(data);
    while (json.length > MAX_BACKUP_BYTES && data.length > 0) {
      data = data.slice(Math.ceil(data.length * 0.1));
      json = JSON.stringify(data);
    }
    localStorage.setItem(BACKUP_KEY, json);
  } catch {}
}

function groupByDay(messages: Message[]): DayGroup[] {
  const map = new Map<string, Message[]>();
  for (const m of messages) {
    const key = new Date(m.ts).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, msgs]) => ({
    date, messages: msgs,
    label: date === today ? 'Hoje' : date === yesterday ? 'Ontem' : new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  }));
}

function loadFabPos() {
  try { const raw = localStorage.getItem(FAB_POS_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { bottom: 24, right: 24 };
}

const AiFab: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const fabPosRef = useRef(loadFabPos());
  const [fabStyle, setFabStyle] = useState<React.CSSProperties>({ bottom: fabPosRef.current.bottom, right: fabPosRef.current.right, position: 'fixed', zIndex: 9999 });
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; initRight: number; initBottom: number } | null>(null);
  const hasDragged = useRef(false);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const onDragStart = useCallback((clientX: number, clientY: number) => {
    hasDragged.current = false;
    dragState.current = { dragging: true, startX: clientX, startY: clientY, initRight: fabPosRef.current.right, initBottom: fabPosRef.current.bottom };
  }, []);

  const onDragMove = useCallback((clientX: number, clientY: number) => {
    if (!dragState.current?.dragging) return;
    const dx = clientX - dragState.current.startX;
    const dy = clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
    const newRight = Math.max(8, Math.min(window.innerWidth - 64, dragState.current.initRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 64, dragState.current.initBottom - dy));
    fabPosRef.current = { bottom: newBottom, right: newRight };
    setFabStyle({ bottom: newBottom, right: newRight, position: 'fixed', zIndex: 9999 });
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragState.current) return;
    dragState.current.dragging = false;
    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(fabPosRef.current)); } catch {}
  }, []);

  useEffect(() => {
    const mm = (e: MouseEvent) => onDragMove(e.clientX, e.clientY);
    const mu = () => onDragEnd();
    const tm = (e: TouchEvent) => { if (e.touches[0]) onDragMove(e.touches[0].clientX, e.touches[0].clientY); };
    const tu = () => onDragEnd();
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', tu);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); window.removeEventListener('touchmove', tm); window.removeEventListener('touchend', tu); };
  }, [onDragMove, onDragEnd]);

  const handleSend = async (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    const userEntry: Message = { role: 'user', text: userMsg, ts: Date.now() };
    setMessages(prev => [...prev, userEntry]);
    setLoading(true);
    try {
      const token = localStorage.getItem('cm_auth_token');
      const backup = loadBackup();
      const recentContext = backup.slice(-10).map(m => `[${new Date(m.ts).toLocaleString('pt-BR')}] ${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.text}`).join('\n');
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: userMsg, historyContext: recentContext })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const aiEntry: Message = { role: 'ai', text: data.reply || 'Sem resposta da IA.', ts: Date.now() };
      setMessages(prev => [...prev, aiEntry]);
      saveBackup([...backup, userEntry, aiEntry]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '⚠️ Erro ao comunicar com a IA.', ts: Date.now() }]);
    } finally { setLoading(false); }
  };

  const allBackup = loadBackup();
  const dayGroups = groupByDay(allBackup);
  const filteredGroups: DayGroup[] = historySearch.trim()
    ? dayGroups.map(g => ({ ...g, messages: g.messages.filter(m => m.text.toLowerCase().includes(historySearch.toLowerCase())) })).filter(g => g.messages.length > 0)
    : dayGroups;

  const toggleDay = (date: string) => setExpandedDays(prev => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });

  useEffect(() => {
    if (activeTab === 'history' && filteredGroups.length > 0) setExpandedDays(new Set([filteredGroups[0].date]));
  }, [activeTab]);

  const windowBottom = Math.min(fabPosRef.current.bottom + 72, window.innerHeight - 540);
  const windowStyle: React.CSSProperties = { position: 'fixed', bottom: Math.max(8, windowBottom), right: fabPosRef.current.right, zIndex: 9999, width: '360px', height: '520px', maxHeight: '85vh', maxWidth: 'calc(100vw - 16px)' };

  return (
    <>
      {!isOpen && (
        <button
          style={fabStyle}
          title="Assistente IA"
          onMouseDown={e => { e.preventDefault(); onDragStart(e.clientX, e.clientY); }}
          onTouchStart={e => { onDragStart(e.touches[0].clientX, e.touches[0].clientY); }}
          onClick={() => { if (!hasDragged.current) setIsOpen(true); }}
          className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-blue-700 hover:scale-105 transition-all select-none touch-none"
        >
          <Bot className="w-7 h-7 pointer-events-none" />
        </button>
      )}

      {isOpen && (
        <div style={windowStyle} className="bg-white rounded-2xl shadow-2xl flex flex-col border border-blue-100 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-white" />
              <div className="flex gap-1">
                <button onClick={() => setActiveTab('chat')} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-all ${activeTab === 'chat' ? 'bg-white/20 text-white font-semibold' : 'text-white/70 hover:text-white'}`}>
                  <MessageSquare className="w-3 h-3" /> Chat
                </button>
                <button onClick={() => setActiveTab('history')} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-all ${activeTab === 'history' ? 'bg-white/20 text-white font-semibold' : 'text-white/70 hover:text-white'}`}>
                  <History className="w-3 h-3" /> Histórico
                </button>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-colors p-1 rounded"><X className="w-5 h-5" /></button>
          </div>

          {activeTab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                {messages.length === 0 && (
                  <div className="text-center text-sm text-gray-400 mt-12">
                    <Bot className="w-10 h-10 mx-auto text-blue-200 mb-3" />
                    <p className="font-medium text-gray-500">Como posso ajudar?</p>
                    <p className="text-xs mt-1">Consulte dados, envie mensagens,<br />crie lembretes e muito mais.</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}`}>
                      <SimpleMarkdown text={m.text} />
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-none px-3 py-2 shadow-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="p-3 bg-white border-t border-gray-100 flex items-end gap-2 shrink-0">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                  placeholder="Pergunte algo à IA..." rows={1}
                  className="flex-1 max-h-28 min-h-[42px] px-3 py-2.5 text-sm bg-gray-50 rounded-xl outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-none" />
                <button onClick={handleSend} disabled={loading || !input.trim()} className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white shrink-0 hover:bg-blue-700 disabled:opacity-40 transition-colors">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {activeTab === 'history' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
              <div className="p-3 bg-white border-b border-gray-100 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                    placeholder="Buscar nas mensagens..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
                </div>
                <p className="text-xs text-gray-400 mt-1 text-right">
                  {allBackup.length} msgs • {(new Blob([JSON.stringify(allBackup)]).size / 1024).toFixed(0)}KB / 5120KB
                </p>
              </div>

              {selectedMsg && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                  <div className="bg-white rounded-xl shadow-xl w-full flex flex-col overflow-hidden" style={{ maxHeight: '80%', minHeight: '200px' }}>
                    <div className="flex justify-between items-center p-3 border-b border-gray-100">
                      <span className="text-xs text-gray-500">{new Date(selectedMsg.ts).toLocaleString('pt-BR')}</span>
                      <button onClick={() => setSelectedMsg(null)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="overflow-y-auto p-4 text-sm leading-relaxed flex-1">
                      <SimpleMarkdown text={selectedMsg.text} highlight={historySearch} />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {filteredGroups.length === 0 && (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    {historySearch ? 'Nenhum resultado encontrado.' : 'Nenhum histórico ainda.'}
                  </div>
                )}
                {filteredGroups.map(group => (
                  <div key={group.date} className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                    <button onClick={() => toggleDay(group.date)} className="w-full flex justify-between items-center px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      <span>{group.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{group.messages.length}</span>
                        {expandedDays.has(group.date) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>
                    {expandedDays.has(group.date) && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {group.messages.map((m, i) => (
                          <button key={i} onClick={() => setSelectedMsg(m)} className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors flex gap-2 items-start ${m.role === 'user' ? '' : 'bg-slate-50/50'}`}>
                            <span className={`shrink-0 font-semibold mt-0.5 ${m.role === 'user' ? 'text-blue-600' : 'text-indigo-500'}`}>{m.role === 'user' ? 'Você' : 'IA'}</span>
                            <span className="text-gray-600 truncate leading-snug flex-1">
                              {m.text.slice(0, 100)}{m.text.length > 100 ? '…' : ''}
                            </span>
                            <span className="shrink-0 text-gray-300">{new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default AiFab;

