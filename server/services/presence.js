// Presença "quem está com essa conversa aberta agora" — em memória, por processo.
// Conta única + processo único => suficiente. Expira sozinho após TTL sem heartbeat.

const TTL_MS = 60 * 1000;
const viewers = new Map(); // chatId -> Map<agentId, { name, department, since, lastSeen }>

function prune(map) {
    const now = Date.now();
    for (const [id, v] of map) if (now - v.lastSeen > TTL_MS) map.delete(id);
}

export function markViewing(chatId, agent) {
    if (!chatId || !agent) return [];
    let map = viewers.get(chatId);
    if (!map) { map = new Map(); viewers.set(chatId, map); }
    const now = Date.now();
    const existing = map.get(agent.id);
    map.set(agent.id, {
        name: agent.name,
        department: agent.department || null,
        since: existing ? existing.since : now,
        lastSeen: now,
    });
    prune(map);
    if (map.size === 0) viewers.delete(chatId);
    return listViewers(chatId);
}

export function stopViewing(chatId, agentId) {
    const map = viewers.get(chatId);
    if (!map) return;
    map.delete(agentId);
    if (map.size === 0) viewers.delete(chatId);
}

export function listViewers(chatId) {
    const map = viewers.get(chatId);
    if (!map) return [];
    prune(map);
    return [...map.entries()]
        .map(([agentId, v]) => ({ agentId, name: v.name, department: v.department, since: v.since }))
        .sort((a, b) => a.since - b.since);
}
