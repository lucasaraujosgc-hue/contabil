import fs from 'fs';
import pg from 'pg';
import { log } from '../logger.js';

const { Pool, types } = pg;

// int8 (BIGINT) volta como number em vez de string — usamos BIGINT só p/ timestamps unix.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// ─────────────────────────────────────────────────────────────────────────────
// Pool (lazy). setPool() permite injetar um mock (pg-mem) nos testes.
// ─────────────────────────────────────────────────────────────────────────────
let pool = null;

export function setPool(p) { pool = p; }

export function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: Number(process.env.PG_POOL_MAX || 10),
            ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
        });
        pool.on('error', (err) => log('[DB] erro no pool ocioso', err));
    }
    return pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptador de dialeto SQLite -> Postgres (nível de string SQL)
// ─────────────────────────────────────────────────────────────────────────────
function adapt(sql) {
    let out = sql;
    // ON CONFLICT(cols) -> ON CONFLICT (cols)
    out = out.replace(/ON CONFLICT\(/gi, 'ON CONFLICT (');
    // datetime('now') / datetime('now','localtime') -> now()
    out = out.replace(/datetime\(\s*'now'\s*(?:,\s*'localtime'\s*)?\)/gi, 'now()');
    // placeholders ? -> $1, $2, ...
    let i = 0;
    out = out.replace(/\?/g, () => `$${++i}`);
    return out;
}

const isPlainInsert = (sql) =>
    /^\s*INSERT\s+INTO/i.test(sql) && !/\bRETURNING\b/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(sql);

// ─────────────────────────────────────────────────────────────────────────────
// Remap de chaves: Postgres devolve colunas em minúsculo; o resto do código
// (e o frontend) esperam camelCase. Lista = colunas/aliases camelCase do schema.
// ─────────────────────────────────────────────────────────────────────────────
const CAMEL = [
    'docNumber', 'companyId', 'companyHash', 'dueDate', 'dayOfWeek', 'recurrenceDate',
    'targetCompanyType', 'createdAt', 'googleTaskId', 'estimatedTime', 'parentId',
    'companyName', 'docName', 'sentAt', 'nextRun', 'selectedCompanyIds', 'attachmentFilename',
    'attachmentOriginalName', 'documentsPayload', 'createdBy', 'serverFilename', 'originalName',
    'mimeType', 'chatId', 'fromMe', 'hasMedia', 'contactName', 'lastSyncTimestamp',
    'extractedData', 'displayName', 'lastTs', 'totalMsgs',
];
const KEY_MAP = Object.fromEntries(CAMEL.map((k) => [k.toLowerCase(), k]));

function remapRow(row) {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const k of Object.keys(row)) out[KEY_MAP[k] || k] = row[k];
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper compatível com a API do better-sqlite3: db.prepare(sql).get/all/run(...)
// Diferença: get/all/run são async (Postgres é assíncrono). Todo call site usa `await`.
// ─────────────────────────────────────────────────────────────────────────────
function makeStatement(exec, rawSql) {
    const sql = adapt(rawSql);
    const cleanParams = (p) => p.map((v) => (v === undefined ? null : v));
    return {
        async get(...params) {
            const r = await exec(sql, cleanParams(params));
            return remapRow(r.rows[0]);
        },
        async all(...params) {
            const r = await exec(sql, cleanParams(params));
            return r.rows.map(remapRow);
        },
        async run(...params) {
            const finalSql = isPlainInsert(sql) ? sql.replace(/;?\s*$/, '') + ' RETURNING id' : sql;
            const r = await exec(finalSql, cleanParams(params));
            return {
                changes: r.rowCount ?? 0,
                lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : undefined,
            };
        },
    };
}

const poolExec = (text, params) => getPool().query(text, params);

export const db = {
    prepare: (sql) => makeStatement(poolExec, sql),
    // acesso cru quando precisar (schema, etc.)
    query: (text, params) => getPool().query(text, params),
};

// getDb(username?) — o argumento é ignorado (multi-tenancy por arquivo removida).
// Mantido com a mesma assinatura para não mexer em ~40 call sites `getDb(req.user)`.
export const getDb = () => db;

// ─────────────────────────────────────────────────────────────────────────────
export async function initDb() {
    const raw = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    try {
        await getPool().query(raw);
    } catch (e) {
        // fallback p/ drivers/mocks que não aceitam múltiplos statements numa query só.
        // Tira comentários "--" e roda statement por statement; ignora falha individual
        // (o schema é todo CREATE ... IF NOT EXISTS — no Postgres real nunca dá erro).
        const clean = raw.replace(/^\s*--.*$/gm, '');
        for (const stmt of clean.split(';').map((s) => s.trim()).filter(Boolean)) {
            try { await getPool().query(stmt); }
            catch (err) { log(`[DB] statement de schema ignorado no fallback: ${err.message.split('\n')[0]}`); }
        }
    }
    log('[DB] schema verificado/criado (Postgres)');
}
