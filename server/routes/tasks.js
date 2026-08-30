import express from 'express';
import { getDb } from '../db/index.js';
import { getGoogleAccessToken } from '../services/googleService.js';
import { requirePermission } from '../middleware/auth.js';
const router = express.Router();

router.get('/tasks/sync', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        const db = getDb(req.user);
        
        try {
            const token = await getGoogleAccessToken();
            const tasksResponse = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showHidden=true&showCompleted=true', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const tasksData = await tasksResponse.json();
            
            if (tasksData.items && Array.isArray(tasksData.items)) {
                const today = new Date().toISOString().split('T')[0];
                for (const gTask of tasksData.items) {
                    const existing = await db.prepare('SELECT id, status FROM tasks WHERE googleTaskId = ?').get(gTask.id);
                    if (!existing) {
                        // insert new task
                        const status = gTask.status === 'completed' ? 'concluida' : 'pendente';
                        await db.prepare(`INSERT INTO tasks (title, description, status, priority, color, dueDate, googleTaskId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                            .run(gTask.title, gTask.notes || '', status, 'media', 'bg-slate-100', gTask.due ? gTask.due.split('T')[0] : '', gTask.id, today);
                    } else {
                        // update if status changed on google maybe?
                        if (gTask.status === 'completed' && existing.status !== 'concluida') {
                            await db.prepare("UPDATE tasks SET status = 'concluida' WHERE googleTaskId = ?").run(gTask.id);
                        } else if (gTask.status === 'needsAction' && existing.status === 'concluida') {
                            await db.prepare("UPDATE tasks SET status = 'pendente' WHERE googleTaskId = ?").run(gTask.id);
                        }
                    }
                }
            } else {
                console.error("Google tasks sync no items or error", tasksData);
            }
        } catch (googleErr) {
            console.error("Google tasks sync error:", googleErr);
        }
        
        res.json(await db.prepare(`SELECT * FROM tasks ORDER BY CASE WHEN status = 'concluida' THEN 1 ELSE 0 END, dueDate ASC, id DESC`).all());
    } catch (err) {
        console.error("/api/tasks/sync error:", err);
        res.json([]);
    }
});

router.get('/tasks', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        res.json(await getDb(req.user).prepare('SELECT * FROM tasks').all());
    } catch (err) {
        res.json([]);
    }
});

router.post('/tasks', (req, res, next) => requirePermission('tasks', (req.body?.id && req.body.id < 1e12) ? 'edit' : 'create')(req, res, next), async (req, res) => {
    const t = req.body;
    const db = getDb(req.user);
    const today = new Date().toISOString().split('T')[0];
    const createdAt = t.createdAt || today;

    try {
        if (t.id && t.id < 1000000000000) {
            const oldTask = await db.prepare('SELECT googleTaskId FROM tasks WHERE id = ?').get(t.id);
            await db.prepare(`UPDATE tasks SET title=?, description=?, status=?, priority=?, color=?, dueDate=?, companyId=?, recurrence=?, dayOfWeek=?, recurrenceDate=?, targetCompanyType=?, createdAt=?, estimatedTime=?, parentId=? WHERE id=?`)
                .run(t.title, t.description, t.status, t.priority, t.color, t.dueDate, t.companyId, t.recurrence, t.dayOfWeek, t.recurrenceDate, t.targetCompanyType, createdAt, t.estimatedTime || null, t.parentId || null, t.id);
            
            if (oldTask && oldTask.googleTaskId && process.env.GOOGLE_CLIENT_ID) {
                try {
                    const token = await getGoogleAccessToken();
                    const statusStr = t.status === 'concluida' ? 'completed' : 'needsAction';
                    await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${oldTask.googleTaskId}`, {
                        method: 'PATCH',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: statusStr, title: t.title, notes: t.description })
                    });
                } catch(e) { console.error('Failed to update Google Task:', e); }
            }
            res.json({ success: true, id: t.id });
        } else {
            let gTaskId = null;
            let parentGoogleId = null;
            if (t.parentId) {
                const parentTask = await db.prepare('SELECT googleTaskId FROM tasks WHERE id = ?').get(t.parentId);
                if (parentTask && parentTask.googleTaskId) {
                    parentGoogleId = parentTask.googleTaskId;
                }
            }

            if (process.env.GOOGLE_CLIENT_ID) {
                try {
                    const token = await getGoogleAccessToken();
                    let dt = t.dueDate;
                    if (dt && dt.includes('T')) {} else if (dt) { dt = dt + 'T00:00:00.000Z'; }
                    const gTaskReq = {
                        title: t.title,
                        notes: t.description || '',
                    };
                    if (dt) {
                        gTaskReq.due = new Date(dt).toISOString();
                    }
                    
                    let url = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
                    if (parentGoogleId) {
                        url += `?parent=${parentGoogleId}`;
                    }

                    const resG = await fetch(url, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(gTaskReq)
                    });
                    const dataG = await resG.json();
                    if (dataG.id) {
                        gTaskId = dataG.id;
                    }
                } catch(e) { console.error('Failed to create Google Task:', e); }
            }

            const result = await db.prepare(`INSERT INTO tasks (title, description, status, priority, color, dueDate, companyId, recurrence, dayOfWeek, recurrenceDate, targetCompanyType, createdAt, estimatedTime, googleTaskId, parentId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(t.title, t.description, t.status, t.priority, t.color, t.dueDate, t.companyId, t.recurrence, t.dayOfWeek, t.recurrenceDate, t.targetCompanyType, createdAt, t.estimatedTime || null, gTaskId, t.parentId || null);

            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (err) {
        res.json({ success: false });
    }
});

router.delete('/tasks/:id', requirePermission('tasks', 'edit'), async (req, res) => {
    try {
        const db = getDb(req.user);
        const oldTask = await db.prepare('SELECT googleTaskId FROM tasks WHERE id = ?').get(req.params.id);
        
        await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
        
        if (oldTask && oldTask.googleTaskId && process.env.GOOGLE_CLIENT_ID) {
            try {
                const token = await getGoogleAccessToken();
                await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${oldTask.googleTaskId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch(e) { console.error('Failed to delete Google Task:', e); }
        }
        
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

export default router;
