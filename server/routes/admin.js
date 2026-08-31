import express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { isEnvAdmin } from '../services/agents.js';
import { importLegacy } from '../../scripts/import-legacy.mjs';

const router = express.Router();
router.use(requireAdmin);
router.use((req, res, next) => {
    if (!isEnvAdmin(req.agent)) return res.status(403).json({ error: 'Somente o administrador do .env.' });
    next();
});

// POST /api/admin/import-legacy  { file?, dry? }
// Importa um .db do sistema antigo que já esteja no volume (DATA_DIR). Sem shell.
router.post('/admin/import-legacy', async (req, res) => {
    try {
        const file = String(req.body?.file || 'legado.db').replace(/[/\\]/g, ''); // sem path traversal
        const full = path.join(DATA_DIR, file);
        if (!fs.existsSync(full)) {
            return res.status(404).json({ error: `Arquivo não encontrado em ${full}. Coloque o .db no volume (pasta data/) primeiro.` });
        }
        const dry = req.body?.dry === true || req.body?.dry === 'true';
        const stats = await importLegacy({ sqlitePath: full, dry });
        res.json({ success: true, dry, file: full, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
