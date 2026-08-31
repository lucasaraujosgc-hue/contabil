import { Conversation } from '../../types';

// minutos que o cliente está esperando resposta (0 se não está esperando)
export function waitingMinutes(c: Conversation, nowSec = Math.floor(Date.now() / 1000)): number {
  if (!c.waiting || !c.waitingSince) return 0;
  return Math.max(0, Math.floor((nowSec - c.waitingSince) / 60));
}

export function waitingLabel(min: number): string {
  if (min <= 0) return '';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}` : `${h}h`;
}

// data/hora curta da última mensagem: "14:32" (hoje), "ontem 14:32", "05/03 14:32", "05/03/24 14:32"
export function shortStamp(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `ontem ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString('pt-BR', sameYear
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${date} ${time}`;
}

export type Urgency = 'none' | 'gray' | 'yellow' | 'red';

export function urgency(min: number, yellowMin = 15, redMin = 30): Urgency {
  if (min <= 0) return 'none';
  if (min >= redMin) return 'red';
  if (min >= yellowMin) return 'yellow';
  return 'gray';
}

export const URGENCY_CLS: Record<Urgency, string> = {
  none: '',
  gray: 'bg-gray-100 text-gray-500',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700 animate-pulse',
};

// filtro da toolbar aplicado no client (o server já filtra, mas mantemos coerência
// ao mesclar eventos SSE sem refetch)
export function matchesFilter(
  c: Conversation,
  filter: 'all' | 'mine' | 'unassigned' | 'waiting' | 'open',
  meId?: number,
): boolean {
  switch (filter) {
    case 'mine': return c.assignedAgentId === meId;
    case 'unassigned': return c.assignedAgentId == null;
    case 'waiting': return c.waiting;
    case 'open': return c.status === 'open';
    default: return true;
  }
}

// aplica um patch de SSE 'conversation_update' no mapa local
export function applyUpdate(
  map: Record<string, Conversation>,
  patch: Partial<Conversation> & { chatId: string },
): Record<string, Conversation> {
  const prev = map[patch.chatId];
  return { ...map, [patch.chatId]: { ...(prev || ({} as Conversation)), ...patch } };
}
