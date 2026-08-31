import express from 'express';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { isEnvAdmin } from '../services/agents.js';

const router = express.Router();

// PUT /api/kanban — layout do board: colunas, tags, setores e limiares de urgência.
// Só o admin do .env. Os CARDS (setor/responsável/status por conversa) vão pela
// tabela wa_conversations via /api/inbox.
router.put('/kanban', requireAdmin, async (req, res) => {
    try {
        if (!isEnvAdmin(req.agent)) return res.status(403).json({ error: 'Somente o administrador pode configurar o Kanban.' });
        const db = getDb();
        const row = await db.prepare('SELECT settings FROM user_settings WHERE id = 1').get();
        const settings = row ? JSON.parse(row.settings) : {};
        const cur = settings.waKanban || {};
        const inc = req.body || {};

        const waKanban = {
            ...cur,
            columns: inc.columns ?? cur.columns ?? [],
            tags: inc.tags ?? cur.tags ?? [],
            departments: inc.departments ?? cur.departments ?? [],
            urgencyYellowMin: Number(inc.urgencyYellowMin ?? cur.urgencyYellowMin ?? 15),
            urgencyRedMin: Number(inc.urgencyRedMin ?? cur.urgencyRedMin ?? 30),
        };
        delete waKanban.cards; // cards agora vivem em wa_conversations

        await db.prepare(
            'INSERT INTO user_settings (id, settings) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET settings = excluded.settings'
        ).run(JSON.stringify({ ...settings, waKanban }));

        res.json({ success: true, waKanban });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
