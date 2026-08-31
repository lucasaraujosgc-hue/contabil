import { log } from '../logger.js';

// Trava em memória para operações de ENVIO (documentos / massa). Evita que um
// retry do usuário — ou um segundo clique enquanto o proxy derrubou a conexão —
// inicie um segundo loop de envio concorrente pra mesma sessão de WhatsApp,
// causando mensagem duplicada.
//
// É por processo (single process). Se o processo cai, some junto. O TTL cobre o
// caso raro de um handler morrer sem liberar.

const STALE_MS = 15 * 60 * 1000; // 15 min
const active = new Map(); // key -> { startedAt, label }

export function acquireSendLock(key, label = 'envio') {
    const k = key || 'default';
    const cur = active.get(k);
    if (cur) {
        if (Date.now() - cur.startedAt < STALE_MS) return false;
        log(`[sendLock] trava velha (${cur.label}, ${Math.round((Date.now() - cur.startedAt) / 1000)}s) — assumindo abandonada`);
    }
    active.set(k, { startedAt: Date.now(), label });
    return true;
}

export function releaseSendLock(key) {
    active.delete(key || 'default');
}

export function sendLockInfo(key) {
    return active.get(key || 'default') || null;
}

// ── dedupe entre requisições ────────────────────────────────────────────────
// Guarda o que JÁ foi enviado com sucesso nos últimos 10 min. Se o proxy derruba
// a conexão mas o servidor termina o lote, e aí o usuário reenvia, o mesmo texto
// pro mesmo número é ignorado em vez de dobrar.
const SEND_TTL_MS = 10 * 60 * 1000;
const recent = new Map(); // key -> ts

export function wasRecentlySent(key) {
    if (!key) return false;
    const ts = recent.get(key);
    if (!ts) return false;
    if (Date.now() - ts > SEND_TTL_MS) { recent.delete(key); return false; }
    return true;
}

export function markSent(key) {
    if (!key) return;
    recent.set(key, Date.now());
    if (recent.size > 5000) {
        const cutoff = Date.now() - SEND_TTL_MS;
        for (const [k, t] of recent) if (t < cutoff) recent.delete(k);
    }
}
