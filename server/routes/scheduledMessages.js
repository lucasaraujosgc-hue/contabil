import express from 'express';
import { getDb } from '../db/index.js';
const router = express.Router();

router.get('/scheduled', async (req, res) => {
    try {
        const rows = await getDb(req.user).prepare("SELECT * FROM scheduled_messages").all();
        res.json(rows.map(row => ({
            ...row, 
            active: !!row.active, 
            channels: JSON.parse(row.channels || '{}'),
            selectedCompanyIds: row.selectedCompanyIds ? JSON.parse(row.selectedCompanyIds) : [],
            documentsPayload: row.documentsPayload || null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/scheduled', async (req, res) => {
    const { id, title, message, nextRun, recurrence, active, type, channels, targetType, selectedCompanyIds, attachmentFilename, attachmentOriginalName, documentsPayload } = req.body;
    const db = getDb(req.user);
    const channelsStr = JSON.stringify(channels);
    const companyIdsStr = JSON.stringify(selectedCompanyIds || []);

    try {
        if (id) {
            await db.prepare(`UPDATE scheduled_messages SET title=?, message=?, nextRun=?, recurrence=?, active=?, type=?, channels=?, targetType=?, selectedCompanyIds=?, attachmentFilename=?, attachmentOriginalName=?, documentsPayload=? WHERE id=?`)
                .run(title, message, nextRun, recurrence, active ? 1 : 0, type, channelsStr, targetType, companyIdsStr, attachmentFilename, attachmentOriginalName, documentsPayload, id);
            res.json({success: true, id});
        } else {
            const result = await db.prepare(`INSERT INTO scheduled_messages (title, message, nextRun, recurrence, active, type, channels, targetType, selectedCompanyIds, attachmentFilename, attachmentOriginalName, documentsPayload, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(title, message, nextRun, recurrence, active ? 1 : 0, type, channelsStr, targetType, companyIdsStr, attachmentFilename, attachmentOriginalName, documentsPayload, req.user);
            res.json({success: true, id: result.lastInsertRowid});
        }
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

router.delete('/scheduled/:id', async (req, res) => {
    try {
        await getDb(req.user).prepare('DELETE FROM scheduled_messages WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

export default router;
