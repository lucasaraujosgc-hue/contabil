import express from 'express';
import { getDb } from '../db/index.js';
import { tenant } from '../config.js';
import { requirePermission } from '../middleware/auth.js';
import { broadcastWaEvent } from '../state/waState.js';
import {
    listConversations, getConversation, patchConversation,
    claimConversation, transferConversation, deleteConversation,
} from '../services/conversations.js';

const router = express.Router();

const emit = (conv, agent) => {
    if (conv) broadcastWaEvent(tenant(), 'conversation_update', { ...conv, updatedBy: agent?.id || null });
};

// GET /api/inbox?filter=mine|unassigned|waiting|open|resolved|all&department=&resolved=1
router.get('/inbox', requirePermission('kanban', 'view'), async (req, res) => {
    try {
        const list = await listConversations(getDb(), {
            filter: req.query.filter || 'all',
            agentId: req.agent?.id,
            department: req.query.department || undefined,
            includeResolved: req.query.resolved === '1' || req.query.resolved === 'true',
        });
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PATCH /api/inbox/:chatId  { colId?, department?, assignedAgentId?, status?, tagIds?, note? }
router.patch('/inbox/:chatId', requirePermission('kanban', 'edit'), async (req, res) => {
    try {
        const conv = await patchConversation(getDb(), req.params.chatId, req.agent, req.body || {});
        emit(conv, req.agent);
        res.json({ success: true, conversation: conv });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/inbox/:chatId/claim  { force? }
router.post('/inbox/:chatId/claim', requirePermission('kanban', 'edit'), async (req, res) => {
    try {
        const r = await claimConversation(getDb(), req.params.chatId, req.agent, { force: !!req.body?.force });
        if (r.conflict) return res.status(409).json(r);
        emit(r.conversation, req.agent);
        res.json({ success: true, conversation: r.conversation });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

const setStatus = (status) => async (req, res) => {
    try {
        const conv = await patchConversation(getDb(), req.params.chatId, req.agent, { status });
        emit(conv, req.agent);
        res.json({ success: true, conversation: conv });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
};
router.post('/inbox/:chatId/resolve', requirePermission('kanban', 'edit'), setStatus('resolved'));
router.post('/inbox/:chatId/reopen', requirePermission('kanban', 'edit'), setStatus('open'));

// POST /api/inbox/:chatId/transfer  { toAgentId?, toDepartment?, note? }
router.post('/inbox/:chatId/transfer', requirePermission('kanban', 'edit'), async (req, res) => {
    try {
        const conv = await transferConversation(getDb(), req.params.chatId, req.agent, req.body || {});
        emit(conv, req.agent);
        res.json({ success: true, conversation: conv });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/inbox/:chatId  — apaga a conversa + histórico de mensagens (limpar lixo)
router.delete('/inbox/:chatId', requirePermission('kanban', 'edit'), async (req, res) => {
    try {
        const r = await deleteConversation(getDb(), req.params.chatId);
        broadcastWaEvent(tenant(), 'conversation_deleted', { chatId: req.params.chatId, updatedBy: req.agent?.id || null });
        res.json({ success: true, ...r });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

export default router;
