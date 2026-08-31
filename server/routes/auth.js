import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { getWaClientWrapper } from '../services/whatsappService.js';
import { authenticateToken, signToken } from '../middleware/auth.js';
import {
    getAgentByUsername, verifyPassword, sanitizeAgent,
    findByInviteToken, activateInvite, listAgents,
} from '../services/agents.js';

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.user || '').toLowerCase().trim()}`,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

// POST /api/login  { user, password }
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { user, password } = req.body || {};
        const db = getDb();
        const agent = await getAgentByUsername(db, user);

        const ok = agent && agent.status === 'active' && await verifyPassword(password, agent.password_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

        getWaClientWrapper(process.env.USERS ? process.env.USERS.split(',')[0].trim() : user); // aquece a sessão de WhatsApp
        res.json({ success: true, token: signToken(agent), agent: sanitizeAgent(agent) });
    } catch (e) {
        res.status(500).json({ error: 'Erro no login' });
    }
});

// GET /api/auth/invite?token=...  (público — valida o convite antes de mostrar o formulário)
router.get('/auth/invite', async (req, res) => {
    const agent = await findByInviteToken(getDb(), req.query.token);
    if (!agent) return res.status(404).json({ error: 'Link inválido ou expirado, peça um novo convite ao administrador.' });
    res.json({ name: agent.name, email: agent.email, reset: agent.status === 'reset_pending' });
});

// POST /api/auth/activate  { token, username, password }  (público)
router.post('/auth/activate', async (req, res) => {
    try {
        const { token, username, password } = req.body || {};
        await activateInvite(getDb(), { rawToken: token, username, password });
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// GET /api/auth/me  (autenticado)
router.get('/auth/me', authenticateToken, (req, res) => {
    res.json(req.agent);
});

// GET /api/auth/agents  — lista enxuta p/ o seletor "responsável" do Kanban (qualquer autenticado)
router.get('/auth/agents', authenticateToken, async (req, res) => {
    try {
        const all = await listAgents(getDb());
        res.json(all
            .filter((a) => a.status === 'active')
            .map((a) => ({ id: a.id, name: a.name, department: a.department, role: a.role })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
