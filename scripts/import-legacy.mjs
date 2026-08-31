#!/usr/bin/env node
// Importa dados úteis de um .db (SQLite) do sistema antigo para o Postgres atual.
//
//   node scripts/import-legacy.mjs /caminho/antigo.db          # aplica
//   node scripts/import-legacy.mjs /caminho/antigo.db --dry    # só mostra o que faria
//
// Traz: empresas (com companyHash), configurações (categorias, palavras-chave,
// regras de vencimento, webhook do Portal do Cliente, assinaturas), pendências
// (SITFIS), status de documentos e anotações.
// IGNORA: conversas/mensagens/contatos do WhatsApp, agentes, logs, agendamentos,
// tarefas (essas sincronizam do Google).
//
// Idempotente e não-destrutivo: só insere o que falta e preenche buracos.

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { getPool, initDb } from '../server/db/index.js';

const digits = (s) => String(s || '').replace(/\D/g, '');
const tbl = (sq, name) => { try { return sq.prepare(`SELECT * FROM ${name}`).all(); } catch { return null; } };
const j = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };

export async function importLegacy({ sqlitePath, dry = false }) {
    const sq = new DatabaseSync(sqlitePath);
    const pg = getPool();
    await initDb();

    const stats = {};
    const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n; };

    // 1) EMPRESAS ─────────────────────────────────────────────────────────────
    {
        const legacy = tbl(sq, 'companies') || [];
        const { rows: cur } = await pg.query('SELECT id, name, docnumber, companyhash, email, whatsapp, nickname, categories FROM companies');
        const byDoc = new Map(cur.filter(c => digits(c.docnumber)).map(c => [digits(c.docnumber), c]));

        for (const c of legacy) {
            const doc = digits(c.docNumber ?? c.docnumber);
            const match = doc ? byDoc.get(doc) : cur.find(x => (x.name || '').toLowerCase() === (c.name || '').toLowerCase());
            if (match) {
                const patch = {};
                if (!match.companyhash && (c.companyHash ?? c.companyhash)) patch.companyhash = c.companyHash ?? c.companyhash;
                if (!match.email && c.email) patch.email = c.email;
                if (!match.whatsapp && c.whatsapp) patch.whatsapp = c.whatsapp;
                if (!match.nickname && c.nickname) patch.nickname = c.nickname;
                if ((!match.categories || match.categories === '[]') && c.categories) patch.categories = c.categories;
                if (Object.keys(patch).length) {
                    bump('empresas_atualizadas');
                    if (!dry) {
                        const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`);
                        await pg.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${sets.length + 1}`, [...Object.values(patch), match.id]);
                        Object.assign(match, patch); // reflete p/ a 2ª passada ser idempotente na mesma sessão
                    }
                } else bump('empresas_ja_ok');
            } else {
                bump('empresas_novas');
                if (!dry) {
                    await pg.query(
                        `INSERT INTO companies (name, docNumber, type, email, whatsapp, categories, observation, companyHash, nickname)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                        [c.name || '(sem nome)', c.docNumber ?? c.docnumber ?? null, c.type ?? null, c.email ?? null,
                         c.whatsapp ?? null, c.categories ?? '[]', c.observation ?? null,
                         c.companyHash ?? c.companyhash ?? null, c.nickname ?? null]);
                }
            }
        }
    }

    // 2) CONFIGURAÇÕES (user_settings id=1) — merge conservador ────────────────
    {
        const row = (() => { try { return sq.prepare('SELECT settings FROM user_settings WHERE id = 1').get(); } catch { return null; } })();
        if (row?.settings) {
            const legacy = j(row.settings, {});
            const { rows } = await pg.query('SELECT settings FROM user_settings WHERE id = 1');
            const curObj = rows[0] ? j(rows[0].settings, {}) : {};
            const merged = { ...curObj };

            const KEYS = [
                'emailSignature', 'whatsappTemplate', 'whatsappFileSignature',
                'visibleDocumentCategories', 'customCategories', 'categoryKeywords',
                'priorityCategories', 'categoryRules', 'companyCategories',
                'dailySummaryNumber', 'dailySummaryTime', 'clientPortalWebhookUrl', 'aiEnabled',
            ];
            for (const k of KEYS) {
                const v = curObj[k];
                const has = v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
                    && !(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
                if (!has && legacy[k] !== undefined) { merged[k] = legacy[k]; bump(`config:${k}`); }
            }

            // Kanban: só o layout se o atual estiver vazio; NUNCA importa cards.
            const lk = legacy.waKanban || {};
            const ck = merged.waKanban || {};
            merged.waKanban = {
                ...ck,
                columns: (ck.columns && ck.columns.length) ? ck.columns : (lk.columns || []),
                tags: (ck.tags && ck.tags.length) ? ck.tags : (lk.tags || []),
                departments: (ck.departments && ck.departments.length) ? ck.departments : (lk.departments || []),
            };
            delete merged.waKanban.cards;

            bump('config_aplicada');
            if (!dry) {
                await pg.query(
                    'INSERT INTO user_settings (id, settings) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET settings = $1',
                    [JSON.stringify(merged)]);
            }
        }
    }

    // 3) PENDÊNCIAS / SITFIS ──────────────────────────────────────────────────
    {
        const legacy = tbl(sq, 'company_pendencies') || [];
        if (legacy.length) {
            const { rows } = await pg.query('SELECT companyid, filename FROM company_pendencies');
            const seen = new Set(rows.map(r => `${r.companyid}|${r.filename}`));
            for (const p of legacy) {
                const key = `${p.companyId ?? p.companyid}|${p.filename}`;
                if (seen.has(key)) { bump('pendencias_ja_ok'); continue; }
                seen.add(key); bump('pendencias_novas');
                if (!dry) {
                    await pg.query(
                        `INSERT INTO company_pendencies (companyId, docNumber, companyName, filename, extractedData, created_at)
                         VALUES ($1,$2,$3,$4,$5,$6)`,
                        [p.companyId ?? p.companyid ?? null, p.docNumber ?? p.docnumber ?? null,
                         p.companyName ?? p.companyname ?? null, p.filename ?? null,
                         p.extractedData ?? p.extracteddata ?? null, p.created_at ?? new Date().toISOString()]);
                }
            }
        }
    }

    // 4) STATUS DE DOCUMENTOS ─────────────────────────────────────────────────
    {
        const legacy = tbl(sq, 'document_status') || [];
        for (const d of legacy) {
            bump('doc_status');
            if (!dry) {
                await pg.query(
                    `INSERT INTO document_status (companyId, category, competence, status) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (companyId, category, competence) DO UPDATE SET status = excluded.status`,
                    [d.companyId ?? d.companyid ?? null, d.category ?? null, d.competence ?? null, d.status ?? null]);
            }
        }
    }

    // 5) ANOTAÇÕES ────────────────────────────────────────────────────────────
    {
        const legacy = tbl(sq, 'personal_notes') || [];
        if (legacy.length) {
            const { rows } = await pg.query('SELECT topic, content FROM personal_notes');
            const seen = new Set(rows.map(r => `${r.topic}|${r.content}`));
            for (const n of legacy) {
                if (seen.has(`${n.topic}|${n.content}`)) { bump('notas_ja_ok'); continue; }
                seen.add(`${n.topic}|${n.content}`); bump('notas_novas');
                if (!dry) {
                    await pg.query(
                        'INSERT INTO personal_notes (topic, content, created_at, updated_at) VALUES ($1,$2,$3,$4)',
                        [n.topic ?? null, n.content ?? null, n.created_at ?? new Date().toISOString(), n.updated_at ?? new Date().toISOString()]);
                }
            }
        }
    }

    sq.close();
    return stats;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('import-legacy.mjs')) {
    const sqlitePath = process.argv[2];
    const dry = process.argv.includes('--dry');
    if (!sqlitePath) {
        console.error('Uso: node scripts/import-legacy.mjs <caminho-do-.db> [--dry]');
        process.exit(1);
    }
    const stats = await importLegacy({ sqlitePath, dry });
    console.log(`\n${dry ? '── PRÉVIA (nada foi gravado) ──' : '── IMPORTAÇÃO CONCLUÍDA ──'}`);
    for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
    if (dry) console.log('\nRode de novo sem --dry para aplicar.');
    try { await getPool().end(); } catch {}
    process.exit(0);
}
