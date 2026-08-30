import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { processAI } from '../services/aiService.js';
import { log } from '../logger.js';
const router = express.Router();

router.post('/ai/chat', authenticateToken, async (req, res) => {
    try {
        const username = req.user;
        const msg = req.body.message;
        const historyContext = req.body.historyContext || '';
        const enrichedMsg = historyContext
            ? `[Contexto do histórico local de conversas com a IA:\n${historyContext}\n---\nMensagem atual:]\n${msg}`
            : msg;
        const reply = await processAI(username, enrichedMsg);
        res.json({ reply });
    } catch (e) {
        log("[AI Route Error]", e);
        res.status(500).json({ error: "Erro na IA" });
    }
});

export default router;
