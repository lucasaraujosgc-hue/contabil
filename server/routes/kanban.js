import express from 'express';
import { getDb } from '../db/index.js';
import { requirePermission } from '../middleware/auth.js';
import { isEnvAdmin } from '../services/agents.js';

const router = express.Router();

const readState = async (db) => {
    const row = await db.prepare('SELECT settings FROM user_settings WHERE id = 1').get();
    const settings = row ? JSON.parse(row.settings) : {};
    return { settings, kanban: settings.waKanban || { columns: [], tags: [], cards: [], departments: [] } };
};

const writeState = async (db, settings, kanban) => {
    const next = JSON.stringify({ ...settings, waKanban: kanban });
    await db.prepare(
        'INSERT INTO user_settings (id, settings) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET settings = excluded.settings'
    ).run(next);
};

// PUT /api/kanban — salva o board.
//   - admin do .env: grava tudo (colunas, tags, setores, cards)
//   - colaborador com kanban.edit: grava SÓ os cards (colId/tags/setor/responsável);
//     colunas/tags/setores ficam congelados no que está no banco.
router.put('/kanban', requirePermission('kanban', 'edit'), async (req, res) => {
    try {
        const db = getDb();
        const incoming = req.body || {};
        const { settings, kanban } = await readState(db);

        const next = isEnvAdmin(req.agent)
            ? {
                columns: incoming.columns ?? kanban.columns ?? [],
                tags: incoming.tags ?? kanban.tags ?? [],
                departments: incoming.departments ?? kanban.departments ?? [],
                cards: incoming.cards ?? kanban.cards ?? [],
              }
            : { ...kanban, cards: Array.isArray(incoming.cards) ? incoming.cards : kanban.cards };

        await writeState(db, settings, next);
        res.json({ success: true, waKanban: next });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
