import express from 'express';
import { getDb } from '../db/index.js';
import { sendDailySummaryToUser } from '../services/whatsappService.js';
const router = express.Router();

router.get('/settings', async (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    try {
        const row = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        res.json(row ? JSON.parse(row.settings) : null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/settings', async (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    const settingsJson = JSON.stringify(req.body);
    try {
        await db.prepare("INSERT INTO user_settings (id, settings) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings").run(settingsJson);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/trigger-daily-summary', async (req, res) => {
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
