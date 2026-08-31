import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { log } from '../logger.js';
import { tenant } from '../config.js';

// "admin do .env" = o agente cujo username é o primeiro de USERS. Só ele mexe nas
// configs globais (categorias, vencimentos, portal, SERPRO, kanban, resumo diário).
export const isEnvAdmin = (agent) =>
    !!(agent && agent.username && agent.username.toLowerCase() === tenant().toLowerCase());

// Campos de settings que são POR COLABORADOR (o resto de user_settings é global).
//  - textos: emailSignature, whatsappTemplate, whatsappFileSignature, waSenderName
//  - flag:   waPrefixEnabled (mostrar "*Nome:*" nas mensagens; padrão true)
export const PERSONAL_SETTING_KEYS = ['emailSignature', 'whatsappTemplate', 'whatsappFileSignature', 'waSenderName'];

// Abas do sistema com permissão granular (view / edit / create).
export const PERMISSION_TABS = ['companies', 'documents', 'tasks', 'kanban', 'financeiro', 'settings'];

const BLANK_PERM = { view: false, edit: false, create: false };

// Permissões padrão de um colaborador novo (o admin ajusta no formulário de convite).
export const DEFAULT_PERMISSIONS = {
    companies: { view: true, edit: false, create: false },
    documents: { view: true, edit: true, create: true },
    tasks: { view: true, edit: true, create: false },
    kanban: { view: true, edit: true, create: false },
    financeiro: { view: false, edit: false, create: false },
    settings: { view: false, edit: false, create: false },
};

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// helpers de hash / token
// ─────────────────────────────────────────────────────────────────────────────
export const hashPassword = (pw) => bcrypt.hash(String(pw), BCRYPT_ROUNDS);
export const verifyPassword = (pw, hash) => (hash ? bcrypt.compare(String(pw), hash) : Promise.resolve(false));

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function newInviteToken() {
    const raw = crypto.randomBytes(32).toString('hex');
    return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// permissões
// ─────────────────────────────────────────────────────────────────────────────
export function parsePermissions(raw) {
    let obj = {};
    try { obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { obj = {}; }
    const out = {};
    for (const tab of PERMISSION_TABS) {
        const p = obj[tab] || {};
        const view = !!p.view || !!p.edit || !!p.create;   // editar/criar implica visualizar
        out[tab] = { view, edit: !!p.edit, create: !!p.create };
    }
    return out;
}

const ALL_TRUE = Object.fromEntries(PERMISSION_TABS.map((t) => [t, { view: true, edit: true, create: true }]));

export function effectivePermissions(agent) {
    if (!agent) return Object.fromEntries(PERMISSION_TABS.map((t) => [t, { ...BLANK_PERM }]));
    if (agent.role === 'admin') return ALL_TRUE;
    return parsePermissions(agent.permissions);
}

export function can(agent, tab, action = 'view') {
    if (agent && agent.role === 'admin') return true;
    const p = effectivePermissions(agent)[tab];
    return !!(p && p[action]);
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO — nunca devolve password_hash / invite_token_hash ao browser
// ─────────────────────────────────────────────────────────────────────────────
export function sanitizeAgent(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        username: row.username || null,
        email: row.email || null,
        department: row.department || null,
        emailAlias: row.email_alias || null,
        emailFromName: row.email_from_name || null,
        role: row.role,
        status: row.status,
        isEnvAdmin: isEnvAdmin(row),
        permissions: parsePermissions(row.permissions),
        inviteExpired: row.status !== 'active' && row.invite_expires_at
            ? new Date(row.invite_expires_at).getTime() < Date.now()
            : false,
        createdAt: row.created_at,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// queries
// ─────────────────────────────────────────────────────────────────────────────
export const getAgentById = (db, id) =>
    db.prepare('SELECT * FROM agents WHERE id = ?').get(id);

export const getAgentByUsername = (db, username) =>
    db.prepare('SELECT * FROM agents WHERE lower(username) = lower(?)').get(String(username || '').trim());

export const listAgents = async (db) =>
    (await db.prepare('SELECT * FROM agents ORDER BY role DESC, name ASC').all()).map(sanitizeAgent);

// --- configs por colaborador (assinaturas) ---
export async function getAgentSettings(db, agentId) {
    const row = await db.prepare('SELECT settings FROM agent_settings WHERE agent_id = ?').get(agentId);
    if (!row || !row.settings) return null;
    try { return JSON.parse(row.settings); } catch { return null; }
}

export async function saveAgentSettings(db, agentId, obj) {
    const clean = {};
    for (const k of PERSONAL_SETTING_KEYS) clean[k] = obj?.[k] ?? '';
    clean.waPrefixEnabled = obj?.waPrefixEnabled !== false; // padrão: mostra o nome
    await db.prepare(
        `INSERT INTO agent_settings (agent_id, settings) VALUES (?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET settings = EXCLUDED.settings`
    ).run(agentId, JSON.stringify(clean));
}

// Nome + toggle usados no prefixo "*Nome:*" do envio manual de WhatsApp.
export async function waSenderConfig(db, agent) {
    const p = agent?.id ? await getAgentSettings(db, agent.id) : null;
    return {
        name: ((p?.waSenderName || agent?.name || 'Atendente') + '').trim(),
        enabled: p?.waPrefixEnabled !== false,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// primeiro boot: cria o admin a partir de USERS[0]/PASSWORDS[0]
// ─────────────────────────────────────────────────────────────────────────────
export async function seedAdminIfEmpty(db) {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM agents').get();
    if (row && Number(row.n) > 0) return;

    // Lê o .env em tempo de chamada (evita problema de ordem de import com dotenv).
    const username = (process.env.USERS || 'admin').split(',')[0]?.trim();
    const password = (process.env.PASSWORDS || '').split(',')[0]?.trim();

    if (!username || !password) {
        log('[AUTH] Nenhum agente cadastrado e USERS[0]/PASSWORDS[0] vazios — defina-os no .env e reinicie para criar o admin.');
        return;
    }
    const permissions = JSON.stringify(ALL_TRUE);
    await db.prepare(
        `INSERT INTO agents (name, username, password_hash, role, permissions, status)
         VALUES (?, ?, ?, 'admin', ?, 'active')`
    ).run(username, username, await hashPassword(password), permissions);
    log(`[AUTH] Agente admin "${username}" criado a partir do .env.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// convite / ativação
// ─────────────────────────────────────────────────────────────────────────────
export async function createInvite(db, { name, email, department, role = 'colaborador', permissions, emailAlias, emailFromName }) {
    if (!name || !email) throw new Error('Nome e e-mail são obrigatórios.');
    const { raw, hash, expiresAt } = newInviteToken();
    const permJson = JSON.stringify(parsePermissions(permissions ?? DEFAULT_PERMISSIONS));
    const res = await db.prepare(
        `INSERT INTO agents (name, email, department, role, permissions, status, invite_token_hash, invite_expires_at, email_alias, email_from_name)
         VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?)`
    ).run(name.trim(), email.trim(), (department || '').trim() || null, role === 'admin' ? 'admin' : 'colaborador', permJson, hash, expiresAt,
          (emailAlias || '').trim() || null, (emailFromName || '').trim() || null);
    const agent = await getAgentById(db, res.lastInsertRowid);
    return { agent, rawToken: raw };
}

// gera novo token para um agente já existente (reenvio de convite / reset de senha)
export async function refreshInvite(db, id, { resetPassword = false } = {}) {
    const agent = await getAgentById(db, id);
    if (!agent) throw new Error('Colaborador não encontrado.');
    const { raw, hash, expiresAt } = newInviteToken();
    const status = resetPassword ? 'reset_pending' : (agent.status === 'active' ? agent.status : 'invited');
    await db.prepare(
        `UPDATE agents SET invite_token_hash = ?, invite_expires_at = ?, status = ?,
                token_version = token_version + ? WHERE id = ?`
    ).run(hash, expiresAt, status, resetPassword ? 1 : 0, id);
    return { agent, rawToken: raw };
}

// valida um token de convite (uso na tela pública, antes de mostrar o formulário)
export async function findByInviteToken(db, rawToken) {
    if (!rawToken) return null;
    const agent = await db.prepare('SELECT * FROM agents WHERE invite_token_hash = ?').get(sha256(rawToken));
    if (!agent) return null;
    if (!agent.invite_expires_at || new Date(agent.invite_expires_at).getTime() < Date.now()) return null;
    return agent;
}

export async function activateInvite(db, { rawToken, username, password }) {
    const agent = await findByInviteToken(db, rawToken);
    if (!agent) throw new Error('Link inválido ou expirado. Peça um novo convite ao administrador.');

    const uname = String(username || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(uname)) throw new Error('Usuário deve ter 3–32 caracteres (letras, números, . _ -).');
    if (String(password || '').length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');

    const taken = await getAgentByUsername(db, uname);
    if (taken && taken.id !== agent.id) throw new Error('Esse nome de usuário já está em uso.');

    await db.prepare(
        `UPDATE agents SET username = ?, password_hash = ?, status = 'active',
                invite_token_hash = NULL, invite_expires_at = NULL WHERE id = ?`
    ).run(uname, await hashPassword(password), agent.id);
    return sanitizeAgent(await getAgentById(db, agent.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// gestão (admin)
// ─────────────────────────────────────────────────────────────────────────────
export async function updateAgent(db, id, { name, email, department, permissions, role, emailAlias, emailFromName }) {
    const agent = await getAgentById(db, id);
    if (!agent) throw new Error('Colaborador não encontrado.');
    await db.prepare(
        `UPDATE agents SET name = ?, email = ?, department = ?, permissions = ?, role = ?,
                email_alias = ?, email_from_name = ? WHERE id = ?`
    ).run(
        (name ?? agent.name).trim(),
        (email ?? agent.email ?? '').trim() || null,
        (department ?? agent.department ?? '').trim() || null,
        JSON.stringify(parsePermissions(permissions ?? agent.permissions)),
        role === 'admin' ? 'admin' : (role === 'colaborador' ? 'colaborador' : agent.role),
        (emailAlias ?? agent.email_alias ?? '').trim() || null,
        (emailFromName ?? agent.email_from_name ?? '').trim() || null,
        id,
    );
    return sanitizeAgent(await getAgentById(db, id));
}

export async function revokeAgent(db, id) {
    const agent = await getAgentById(db, id);
    if (!agent) throw new Error('Colaborador não encontrado.');
    if (agent.role === 'admin') throw new Error('Não é possível revogar o administrador.');
    await db.prepare(
        `UPDATE agents SET status = 'revoked', token_version = token_version + 1 WHERE id = ?`
    ).run(id);
    return sanitizeAgent(await getAgentById(db, id));
}

export async function reactivateAgent(db, id) {
    const agent = await getAgentById(db, id);
    if (!agent) throw new Error('Colaborador não encontrado.');
    const status = agent.username && agent.password_hash ? 'active' : 'invited';
    await db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id);
    return sanitizeAgent(await getAgentById(db, id));
}
