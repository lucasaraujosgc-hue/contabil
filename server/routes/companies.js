import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { requirePermission } from '../middleware/auth.js';
const router = express.Router();

router.get('/companies', requirePermission('companies', 'view'), async (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    try {
        const rows = await db.prepare('SELECT * FROM companies ORDER BY name ASC').all();
        res.json(rows.map(r => ({...r, categories: r.categories ? JSON.parse(r.categories) : []})));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/companies', (req, res, next) => {
    return requirePermission('companies', req.body?.id ? 'edit' : 'create')(req, res, next);
}, async (req, res) => {
    const { id, name, nickname, docNumber, type, email, whatsapp, categories, observation, companyHash } = req.body;
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    
    const catStr = JSON.stringify(categories || []);
    const hashToSave = companyHash || crypto.randomUUID();

    try {
        if (id) {
            await db.prepare(`UPDATE companies SET name=?, nickname=?, docNumber=?, type=?, email=?, whatsapp=?, categories=?, observation=?, companyHash=COALESCE(companyHash, ?) WHERE id=?`)
                .run(name, nickname || '', docNumber, type, email, whatsapp, catStr, observation || '', hashToSave, id);
            res.json({success: true, id});
        } else {
            const result = await db.prepare(`INSERT INTO companies (name, nickname, docNumber, type, email, whatsapp, categories, observation, companyHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(name, nickname || '', docNumber, type, email, whatsapp, catStr, observation || '', hashToSave);
            res.json({success: true, id: result.lastInsertRowid});
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/companies/:id', requirePermission('companies', 'edit'), async (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    try {
        await db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
