import React, { useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Loader2, ShieldCheck, Mail, RotateCcw, Ban, KeyRound, Pencil, X, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { api } from '../services/api';

const TAB_LABELS: Record<string, string> = {
  companies: 'Empresas', documents: 'Documentos', tasks: 'Tarefas',
  kanban: 'Kanban', financeiro: 'Financeiro', settings: 'Configurações',
};
const DEPARTMENTS = ['Fiscal', 'Contábil', 'Pessoal / RH', 'Financeiro', 'Societário', 'Atendimento'];

type Perm = { view: boolean; edit: boolean; create: boolean };
type Agent = {
  id: number; name: string; username: string | null; email: string | null;
  department: string | null; role: 'admin' | 'colaborador'; status: string;
  permissions: Record<string, Perm>; inviteExpired?: boolean;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Ativo', cls: 'bg-green-100 text-green-700' },
  invited: { label: 'Convite enviado', cls: 'bg-amber-100 text-amber-700' },
  reset_pending: { label: 'Redefinindo senha', cls: 'bg-amber-100 text-amber-700' },
  revoked: { label: 'Revogado', cls: 'bg-red-100 text-red-700' },
};

function normalizePerms(p: Record<string, Perm>, tabs: string[]): Record<string, Perm> {
  const out: Record<string, Perm> = {};
  for (const t of tabs) {
    const v = p?.[t] || { view: false, edit: false, create: false };
    out[t] = { view: v.view || v.edit || v.create, edit: !!v.edit, create: !!v.create };
  }
  return out;
}

const Users: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [defaultPermissions, setDefaultPermissions] = useState<Record<string, Perm>>({});
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [confirming, setConfirming] = useState<{ agent: Agent; action: 'revoke' | 'reset-password' } | null>(null);

  const reload = async () => {
    setLoading(true); setErr('');
    try {
      const data = await api.listAgents();
      setAgents(data.agents); setTabs(data.tabs); setDefaultPermissions(data.defaultPermissions);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const doAction = async (agent: Agent, action: 'revoke' | 'reactivate' | 'reset-password' | 'resend-invite') => {
    try {
      const r = await api.agentAction(agent.id, action);
      if (action === 'reset-password') flash(r.emailSent ? `E-mail de redefinição enviado para ${agent.email}` : `Senha resetada, mas o e-mail falhou: ${r.emailError}`);
      if (action === 'resend-invite') flash(r.emailSent ? `Convite reenviado para ${agent.email}` : `Falha ao reenviar: ${r.emailError}`);
      if (action === 'revoke') flash(`${agent.name} foi revogado.`);
      if (action === 'reactivate') flash(`${agent.name} foi reativado.`);
      await reload();
    } catch (e: any) { setErr(e.message); }
    setConfirming(null);
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" /> Usuários e permissões
          </h2>
          <p className="text-sm text-gray-500 mt-1">Convide colaboradores e defina o que cada um pode ver e fazer.</p>
        </div>
        <button onClick={() => setEditing('new')} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
          <UserPlus className="w-4 h-4" /> Adicionar colaborador
        </button>
      </div>

      {toast && <div className="mb-4 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{toast}</div>}
      {err && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{err}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-12 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Carregando...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">E-mail</th>
                <th className="text-left px-4 py-3">Setor</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agents.map((a) => {
                const badge = STATUS_BADGE[a.status] || { label: a.status, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {a.name}
                      {a.role === 'admin' && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">admin</span>}
                      {a.username && <span className="block text-xs text-gray-400">@{a.username}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{a.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{a.department || '—'}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${badge.cls}`}>{badge.label}</span></td>
                    <td className="px-4 py-3">
                      {a.role !== 'admin' && (
                        <div className="flex items-center justify-end gap-1">
                          <button title="Editar" onClick={() => setEditing(a)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil className="w-4 h-4" /></button>
                          {(a.status === 'invited' || a.status === 'reset_pending') && a.inviteExpired && (
                            <button title="Reenviar convite" onClick={() => doAction(a, 'resend-invite')} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"><Mail className="w-4 h-4" /></button>
                          )}
                          {a.status === 'active' && (
                            <button title="Resetar senha" onClick={() => setConfirming({ agent: a, action: 'reset-password' })} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"><KeyRound className="w-4 h-4" /></button>
                          )}
                          {a.status === 'revoked'
                            ? <button title="Reativar" onClick={() => doAction(a, 'reactivate')} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"><RotateCcw className="w-4 h-4" /></button>
                            : <button title="Revogar acesso" onClick={() => setConfirming({ agent: a, action: 'revoke' })} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Ban className="w-4 h-4" /></button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AgentModal
          mode={editing === 'new' ? 'new' : 'edit'}
          agent={editing === 'new' ? null : editing}
          tabs={tabs}
          defaultPermissions={normalizePerms(defaultPermissions, tabs)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); flash(msg); reload(); }}
          onError={setErr}
        />
      )}

      {confirming && (
        <ConfirmModal
          title={confirming.action === 'revoke' ? 'Revogar acesso' : 'Resetar senha'}
          body={confirming.action === 'revoke'
            ? `${confirming.agent.name} perde o acesso imediatamente e qualquer sessão ativa é encerrada.`
            : `${confirming.agent.name} recebe um e-mail para definir uma nova senha. A sessão atual dele é encerrada na hora.`}
          confirmLabel={confirming.action === 'revoke' ? 'Revogar' : 'Resetar senha'}
          danger={confirming.action === 'revoke'}
          onCancel={() => setConfirming(null)}
          onConfirm={() => doAction(confirming.agent, confirming.action)}
        />
      )}
    </div>
  );
};

// ─── Modal de criar / editar ────────────────────────────────────────────────
const AgentModal: React.FC<{
  mode: 'new' | 'edit'; agent: Agent | null; tabs: string[];
  defaultPermissions: Record<string, Perm>;
  onClose: () => void; onSaved: (msg: string) => void; onError: (m: string) => void;
}> = ({ mode, agent, tabs, defaultPermissions, onClose, onSaved, onError }) => {
  const [name, setName] = useState(agent?.name || '');
  const [email, setEmail] = useState(agent?.email || '');
  const [department, setDepartment] = useState(agent?.department || '');
  const [perms, setPerms] = useState<Record<string, Perm>>(
    () => normalizePerms(agent?.permissions || defaultPermissions, tabs)
  );
  const [saving, setSaving] = useState(false);

  const toggle = (tab: string, action: keyof Perm) => {
    setPerms((prev) => {
      const cur = { ...prev[tab] };
      cur[action] = !cur[action];
      if ((action === 'edit' || action === 'create') && cur[action]) cur.view = true; // editar/criar implica ver
      if (action === 'view' && !cur.view) { cur.edit = false; cur.create = false; }   // tirar ver tira o resto
      return { ...prev, [tab]: cur };
    });
  };

  const save = async () => {
    if (!name.trim() || !email.trim()) { onError('Nome e e-mail são obrigatórios.'); return; }
    setSaving(true);
    try {
      if (mode === 'new') {
        const r = await api.createAgent({ name, email, department, permissions: perms });
        onSaved(r.emailSent ? `Convite enviado para ${email}` : `Colaborador criado, mas o e-mail falhou: ${r.emailError}`);
      } else {
        await api.updateAgent(agent!.id, { name, email, department, permissions: perms });
        onSaved('Colaborador atualizado.');
      }
    } catch (e: any) { onError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-bold text-gray-800">{mode === 'new' ? 'Novo colaborador' : `Editar ${agent?.name}`}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Setor</label>
            <input list="dept-list" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="ex: Fiscal" />
            <datalist id="dept-list">{DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Permissões</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Aba</th>
                    <th className="px-3 py-2 w-24">Visualizar</th>
                    <th className="px-3 py-2 w-20">Editar</th>
                    <th className="px-3 py-2 w-20">Criar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tabs.map((t) => (
                    <tr key={t}>
                      <td className="px-3 py-2 font-medium text-gray-700">{TAB_LABELS[t] || t}</td>
                      {(['view', 'edit', 'create'] as (keyof Perm)[]).map((act) => (
                        <td key={act} className="text-center px-3 py-2">
                          <input type="checkbox" checked={perms[t][act]} onChange={() => toggle(t, act)}
                            className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Marcar "Editar" ou "Criar" habilita "Visualizar" automaticamente.</p>
          </div>
          {mode === 'edit' && <p className="text-xs text-gray-400">A senha nunca é definida aqui — use "Resetar senha" na lista para enviar um novo link ao colaborador.</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'new' ? 'Enviar convite' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmModal: React.FC<{
  title: string; body: string; confirmLabel: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => void;
}> = ({ title, body, confirmLabel, danger, onCancel, onConfirm }) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
          <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-amber-600'}`} />
        </div>
        <div>
          <h3 className="font-bold text-gray-800">{title}</h3>
          <p className="text-sm text-gray-600 mt-1">{body}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button onClick={onConfirm} className={`px-4 py-2 text-sm text-white rounded-lg font-semibold ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>{confirmLabel}</button>
      </div>
    </div>
  </div>
);

export default Users;
