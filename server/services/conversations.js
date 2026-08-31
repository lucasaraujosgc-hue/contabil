import { log } from '../logger.js';
import { listViewers } from './presence.js';

// Metadados de atendimento de uma conversa do WhatsApp (tabela wa_conversations).
// DTO em camelCase; a tabela é snake_case (round-trip ok no Postgres).

const STATUSES = ['open', 'pending', 'resolved'];
const now = () => Math.floor(Date.now() / 1000);

function toDto(row, extra = {}) {
    if (!row) return null;
    let tagIds = [];
    try { tagIds = JSON.parse(row.tag_ids || '[]'); } catch { tagIds = []; }
    const lastInboundAt = row.last_inbound_at ? Number(row.last_inbound_at) : null;
    const lastOutboundAt = row.last_outbound_at ? Number(row.last_outbound_at) : null;
    return {
        chatId: row.chat_id,
        name: row.name || null,
        colId: row.col_id || null,
        department: row.department || null,
        assignedAgentId: row.assigned_agent_id || null,
        status: row.status || 'open',
        tagIds,
        note: row.note || '',
        lastInboundAt,
        lastOutboundAt,
        lastActivityAt: row.last_activity_at ? Number(row.last_activity_at) : null,
        // cliente esperando resposta?
        waiting: !!(lastInboundAt && lastInboundAt > (lastOutboundAt || 0)),
        waitingSince: (lastInboundAt && lastInboundAt > (lastOutboundAt || 0)) ? lastInboundAt : null,
        resolvedAt: row.resolved_at || null,
        ...extra,
    };
}

// ── criação / heartbeat de mensagens ────────────────────────────────────────
export async function ensureConversation(db, chatId, name) {
    if (!chatId) return;
    try {
        await db.prepare(
            `INSERT INTO wa_conversations (chat_id, name, last_activity_at)
             VALUES (?, ?, ?) ON CONFLICT (chat_id) DO NOTHING`
        ).run(chatId, name || null, now());
    } catch (e) { log(`[conv] ensure ${chatId}: ${e.message}`); }
}

// Chamado SÓ pelos handlers ao vivo (message / message_create), não no bulk.
export async function touchConversation(db, chatId, { fromMe, ts, name } = {}) {
    if (!chatId) return null;
    const t = Number(ts) || now();
    await ensureConversation(db, chatId, name);
    const col = fromMe ? 'last_outbound_at' : 'last_inbound_at';
    // msg do cliente numa conversa resolvida -> reabre
    const reopen = fromMe ? '' : `, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END`;
    await db.prepare(
        `UPDATE wa_conversations
            SET ${col} = ?, last_activity_at = ?, name = COALESCE(?, name), updated_at = now()${reopen}
          WHERE chat_id = ?`
    ).run(t, t, name || null, chatId);
    return getConversation(db, chatId);
}

// ── leitura ─────────────────────────────────────────────────────────────────
export async function getConversation(db, chatId) {
    const row = await db.prepare('SELECT * FROM wa_conversations WHERE chat_id = ?').get(chatId);
    return toDto(row, { viewers: listViewers(chatId) });
}

export async function listConversations(db, { filter = 'all', agentId, department, includeResolved = false } = {}) {
    const where = [];
    const params = [];
    if (!includeResolved && filter !== 'resolved') where.push("status <> 'resolved'");
    if (filter === 'mine') { where.push('assigned_agent_id = ?'); params.push(agentId); }
    if (filter === 'unassigned') where.push('assigned_agent_id IS NULL');
    if (filter === 'waiting') where.push('last_inbound_at IS NOT NULL AND last_inbound_at > COALESCE(last_outbound_at, 0)');
    if (filter === 'open') where.push("status = 'open'");
    if (filter === 'resolved') where.push("status = 'resolved'");
    if (department) { where.push('department = ?'); params.push(department); }

    const rows = await db.prepare(`
        SELECT * FROM wa_conversations
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (last_inbound_at IS NOT NULL AND last_inbound_at > COALESCE(last_outbound_at,0)) DESC,
                 COALESCE(last_activity_at, 0) DESC
    `).all(...params);
    if (!rows.length) return [];

    const ids = rows.map((r) => r.chat_id);
    const ph = ids.map(() => '?').join(',');
    const msgs = await db.prepare(
        `SELECT chatId, body, fromMe, timestamp FROM whatsapp_messages WHERE chatId IN (${ph}) ORDER BY timestamp DESC`
    ).all(...ids);
    const lastMsg = {};
    for (const m of msgs) if (!lastMsg[m.chatId]) lastMsg[m.chatId] = m; // 1º = mais recente
    const contacts = await db.prepare(
        `SELECT contact_id, name FROM whatsapp_contacts WHERE contact_id IN (${ph})`
    ).all(...ids);
    const contactName = Object.fromEntries(contacts.map((c) => [c.contact_id, c.name]));

    return rows.map((r) => toDto(r, {
        name: r.name || contactName[r.chat_id] || null,
        lastMessage: lastMsg[r.chat_id]?.body || '',
        lastMessageFromMe: !!lastMsg[r.chat_id]?.fromMe,
        viewers: listViewers(r.chat_id),
    }));
}

// ── mutações ────────────────────────────────────────────────────────────────
export async function patchConversation(db, chatId, agent, patch = {}) {
    await ensureConversation(db, chatId, patch.name);
    const sets = [];
    const params = [];
    const add = (col, val) => { sets.push(`${col} = ?`); params.push(val); };

    if ('colId' in patch) add('col_id', patch.colId || null);
    if ('department' in patch) add('department', patch.department || null);
    if ('note' in patch) add('note', patch.note || null);
    if ('tagIds' in patch) add('tag_ids', JSON.stringify(Array.isArray(patch.tagIds) ? patch.tagIds : []));
    if ('assignedAgentId' in patch) {
        const id = patch.assignedAgentId || null;
        add('assigned_agent_id', id);
        sets.push(id ? 'claimed_at = now()' : 'claimed_at = NULL');
    }
    if ('status' in patch && STATUSES.includes(patch.status)) {
        add('status', patch.status);
        if (patch.status === 'resolved') {
            sets.push('resolved_at = now()');
            add('resolved_by', agent?.id || null);
        } else {
            sets.push('resolved_at = NULL', 'resolved_by = NULL');
        }
    }
    if (!sets.length) return getConversation(db, chatId);

    sets.push('updated_at = now()');
    await db.prepare(`UPDATE wa_conversations SET ${sets.join(', ')} WHERE chat_id = ?`).run(...params, chatId);
    return getConversation(db, chatId);
}

export async function claimConversation(db, chatId, agent, { force = false } = {}) {
    const cur = await db.prepare('SELECT assigned_agent_id FROM wa_conversations WHERE chat_id = ?').get(chatId);
    const currentId = cur?.assigned_agent_id || null;
    if (currentId && currentId !== agent.id && !force) {
        const other = await db.prepare('SELECT name FROM agents WHERE id = ?').get(currentId);
        return { conflict: true, current: { agentId: currentId, name: other?.name || 'outro atendente' } };
    }
    const conv = await patchConversation(db, chatId, agent, { assignedAgentId: agent.id });
    return { conflict: false, conversation: conv };
}

// apaga a conversa do quadro E o histórico de mensagens/contato/sync (limpar lixo).
// Reaparece do zero se o cliente mandar mensagem de novo.
export async function deleteConversation(db, chatId) {
    if (!chatId) return { deleted: false };
    const msgs = await db.prepare('SELECT COUNT(*) AS n FROM whatsapp_messages WHERE chatId = ?').get(chatId);
    await db.prepare('DELETE FROM whatsapp_messages WHERE chatId = ?').run(chatId);
    await db.prepare('DELETE FROM whatsapp_sync WHERE chatId = ?').run(chatId);
    await db.prepare('DELETE FROM whatsapp_contacts WHERE contact_id = ?').run(chatId);
    await db.prepare('DELETE FROM wa_conversations WHERE chat_id = ?').run(chatId);
    return { deleted: true, messages: Number(msgs?.n || 0) };
}

export async function transferConversation(db, chatId, agent, { toAgentId, toDepartment, note } = {}) {
    const patch = {};
    if (toAgentId !== undefined) patch.assignedAgentId = toAgentId || null;
    if (toDepartment !== undefined) patch.department = toDepartment || null;
    const conv = await patchConversation(db, chatId, agent, patch);
    if (note && String(note).trim()) {
        const prev = (await db.prepare('SELECT note FROM wa_conversations WHERE chat_id = ?').get(chatId))?.note || '';
        const stamp = new Date().toLocaleString('pt-BR');
        const line = `[${stamp}] ${agent?.name || 'Atendente'}: ${String(note).trim()}`;
        await db.prepare('UPDATE wa_conversations SET note = ? WHERE chat_id = ?').run(prev ? `${prev}\n${line}` : line, chatId);
    }
    return getConversation(db, chatId);
}

// ── migração: backfill a partir do blob antigo ──────────────────────────────
export async function migrateConversations(db) {
    try {
        const count = await db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get();
        if (count && Number(count.n) > 0) return;
        const row = await db.prepare('SELECT settings FROM user_settings WHERE id = 1').get();
        const cards = row ? (JSON.parse(row.settings).waKanban?.cards || []) : [];
        if (!cards.length) return;
        for (const c of cards) {
            if (!c.id) continue;
            await db.prepare(
                `INSERT INTO wa_conversations (chat_id, name, col_id, department, assigned_agent_id, tag_ids)
                 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (chat_id) DO NOTHING`
            ).run(c.id, c.name || null, c.colId || null, c.department || null,
                  c.assignedAgentId || null, JSON.stringify(c.tagIds || []));
        }
        log(`[conv] migração: ${cards.length} conversas importadas do waKanban.cards`);
    } catch (e) {
        log(`[conv] migração falhou: ${e.message}`);
    }
}
