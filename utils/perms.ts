export type PermAction = 'view' | 'edit' | 'create';

export interface AgentPermissions {
  [tab: string]: { view: boolean; edit: boolean; create: boolean };
}
export interface Agent {
  id: number;
  name: string;
  username: string | null;
  email: string | null;
  department: string | null;
  role: 'admin' | 'colaborador';
  status: string;
  permissions: AgentPermissions;
}

// activePage -> [aba, ação] exigida. null = aberto a qualquer autenticado.
export const PAGE_PERMISSION: Record<string, [string, PermAction] | null> = {
  kanban: ['kanban', 'view'],
  dashboard: ['tasks', 'view'],
  companies: ['companies', 'view'],
  pendencies: ['companies', 'view'],
  documents: ['documents', 'view'],
  upload: ['documents', 'create'],
  send: ['documents', 'edit'],
  bulksend: ['documents', 'edit'],
  scheduled: null,
  whatsapp: ['kanban', 'view'],
  gallery: ['documents', 'view'],
  settings: null,
  users: null, // admin-only, tratado à parte
};

export function can(agent: Agent | null | undefined, tab: string, action: PermAction = 'view'): boolean {
  if (!agent) return false;
  if (agent.role === 'admin') return true;
  const p = agent.permissions?.[tab];
  return !!(p && p[action]);
}

export function canSeePage(agent: Agent | null | undefined, page: string): boolean {
  if (!agent) return false;
  if (page === 'users') return agent.role === 'admin';
  const rule = PAGE_PERMISSION[page];
  if (!rule) return true;
  return can(agent, rule[0], rule[1]);
}

// ordem do menu — usada p/ escolher a primeira página que o colaborador pode ver
export const PAGE_ORDER = [
  'kanban', 'dashboard', 'companies', 'pendencies', 'documents',
  'upload', 'send', 'bulksend', 'scheduled', 'whatsapp', 'gallery', 'settings', 'users',
];

export function firstAllowedPage(agent: Agent | null | undefined): string {
  return PAGE_ORDER.find((p) => canSeePage(agent, p)) || 'settings';
}
