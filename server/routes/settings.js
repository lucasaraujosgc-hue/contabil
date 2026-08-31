import express from 'express';
import { getDb } from '../db/index.js';
import { sendDailySummaryToUser } from '../services/whatsappService.js';
import { isEnvAdmin, getAgentSettings, saveAgentSettings, PERSONAL_SETTING_KEYS } from '../services/agents.js';
const router = express.Router();

// GET /settings — configs GLOBAIS + a assinatura PESSOAL do agente logado.
//   - admin do .env: vê a assinatura global (é o "dono" dela) até personalizar
//   - colaborador: assinatura em branco até salvar a sua
router.get('/settings', async (req, res) => {
    const db = getDb();
    try {
        const row = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        const global = row ? JSON.parse(row.settings) : {};

        const personal = await getAgentSettings(db, req.agent?.id);
        const admin = isEnvAdmin(req.agent);
        for (const k of PERSONAL_SETTING_KEYS) {
            if (personal && personal[k] !== undefined) global[k] = personal[k];
            else if (!admin) global[k] = '';   // colaborador sem config pessoal -> em branco
            // admin sem config pessoal -> mantém o valor global
        }
        // toggle do prefixo "*Nome:*" — por colaborador, padrão ligado
        global.waPrefixEnabled = personal?.waPrefixEnabled !== false;
        global.waSenderName = personal?.waSenderName || '';
        res.json(global);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /settings — separa: assinatura vai pro agente; o resto (global) só o admin do .env.
router.post('/settings', async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    try {
        // 1) assinatura pessoal — qualquer agente autenticado salva a sua
        if (req.agent?.id) await saveAgentSettings(db, req.agent.id, body);

        // 2) configs globais — só o admin do .env
        if (isEnvAdmin(req.agent)) {
            await db.prepare(
                "INSERT INTO user_settings (id, settings) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings"
            ).run(JSON.stringify(body));
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Resumo Diário — só o admin do .env configura e dispara.
router.post('/trigger-daily-summary', async (req, res) => {
    if (!isEnvAdmin(req.agent)) return res.status(403).json({ error: 'Somente o administrador pode disparar o resumo.' });
    try {
        const result = await sendDailySummaryToUser(req.user);
        if (result && result.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result ? result.message : "Falha desconhecida" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
