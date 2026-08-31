import express from 'express';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/emailService.js';
import {
    listAgents, createInvite, refreshInvite, updateAgent,
    revokeAgent, reactivateAgent, sanitizeAgent, getAgentById,
    PERMISSION_TABS, DEFAULT_PERMISSIONS,
} from '../services/agents.js';

const router = express.Router();
router.use(requireAdmin); // authenticateToken já rodou no gate global

// GET /api/agents  — lista + metadados p/ montar o formulário
router.get('/', async (req, res) => {
    try {
        res.json({
            agents: await listAgents(getDb()),
            tabs: PERMISSION_TABS,
            defaultPermissions: DEFAULT_PERMISSIONS,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/agents  { name, email, department, role?, permissions } -> cria convite + envia e-mail
router.post('/', async (req, res) => {
    try {
        const { agent, rawToken } = await createInvite(getDb(), req.body || {});
        let emailSent = true, emailError;
        try { await sendInviteEmail(agent, rawToken, { req }); }
        catch (e) { emailSent = false; emailError = e.message; }
        res.json({ success: true, agent: sanitizeAgent(agent), emailSent, emailError });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/agents/:id  { name, email, department, permissions, role }
router.put('/:id', async (req, res) => {
    try {
        res.json({ success: true, agent: await updateAgent(getDb(), Number(req.params.id), req.body || {}) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/agents/:id/revoke
router.post('/:id/revoke', async (req, res) => {
    try {
        res.json({ success: true, agent: await revokeAgent(getDb(), Number(req.params.id)) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/agents/:id/reactivate
router.post('/:id/reactivate', async (req, res) => {
    try {
        res.json({ success: true, agent: await reactivateAgent(getDb(), Number(req.params.id)) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/agents/:id/reset-password  — novo token + status reset_pending + derruba sessão
router.post('/:id/reset-password', async (req, res) => {
    try {
        const { agent, rawToken } = await refreshInvite(getDb(), Number(req.params.id), { resetPassword: true });
        let emailSent = true, emailError;
        try { await sendInviteEmail(agent, rawToken, { reset: true, req }); }
        catch (e) { emailSent = false; emailError = e.message; }
        res.json({ success: true, agent: sanitizeAgent(await getAgentById(getDb(), agent.id)), emailSent, emailError });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/agents/:id/resend-invite  — novo token (mesmo status) + reenvia e-mail
router.post('/:id/resend-invite', async (req, res) => {
    try {
        const { agent, rawToken } = await refreshInvite(getDb(), Number(req.params.id));
        let emailSent = true, emailError;
        try { await sendInviteEmail(agent, rawToken, { req }); }
        catch (e) { emailSent = false; emailError = e.message; }
        res.json({ success: true, emailSent, emailError });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

export default router;
