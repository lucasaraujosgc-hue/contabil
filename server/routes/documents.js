import express from 'express';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { acquireSendLock, releaseSendLock } from '../services/sendLock.js';
import { createJob, jobSnapshot, cancelJob, runSendDocuments } from '../services/sendJobs.js';
const router = express.Router();

router.post('/upload', requirePermission('documents','create'), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
    res.json({ filename: req.file.filename, originalName: req.file.originalname });
});

router.post('/notify-webhook', requirePermission('documents','create'), async (req, res) => {
    try {
        const { serverFilename, originalName, dueDate, category, companyId, competence } = req.body;
        if (!serverFilename || !companyId) return res.json({ success: true, reason: 'missing data' });

        const db = getDb(req.user);
        const settingsRow = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        if (!settingsRow) return res.json({ success: true, reason: 'no settings' });
        
        const settings = JSON.parse(settingsRow.settings);
        if (!settings.clientPortalWebhookUrl) return res.json({ success: true, reason: 'no webhook url' });

        const companyRow = await db.prepare("SELECT companyHash FROM companies WHERE id = ?").get(companyId);
        if (!companyRow || !companyRow.companyHash) return res.json({ success: true, reason: 'no company hash' });

        const filePath = path.join(UPLOADS_DIR, serverFilename);
        if (!fs.existsSync(filePath)) {
            return res.json({ success: false, reason: 'file not found' });
        }

        const fileBuffer = fs.readFileSync(filePath);
        const pdfBase64 = fileBuffer.toString('base64');

        const payload = {
            hash_empresa: companyRow.companyHash,
            vencimento: dueDate || '',
            competencia: competence || '',
            categoria: category || '',
            nome_arquivo: originalName || serverFilename,
            arquivo_base64: pdfBase64
        };

        const result = await fetch(settings.clientPortalWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!result.ok) {
            log(`Webhook POST falhou com status ${result.status}`);
        } else {
            log(`Webhook notificado para hash ${companyRow.companyHash}`);
        }

        res.json({ success: true });
    } catch(e) {
        log('Erro no webhook: ', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/documents/status', requirePermission('documents','view'), async (req, res) => {
    try {
        const sql = req.query.competence ? 'SELECT * FROM document_status WHERE competence = ?' : 'SELECT * FROM document_status';
        const rows = req.query.competence
            ? await getDb(req.user).prepare(sql).all(req.query.competence)
            : await getDb(req.user).prepare(sql).all();
        res.json(rows);
    } catch (err) {
        res.json([]);
    }
});

router.post('/documents/status', requirePermission('documents','edit'), async (req, res) => {
    const { companyId, category, competence, status } = req.body;
    try {
        await getDb(req.user).prepare(
            `INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, ?) ON CONFLICT(companyId, category, competence) DO UPDATE SET status = excluded.status`
        ).run(companyId, category, competence, status);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

router.post('/send-documents', requirePermission('documents','edit'), async (req, res) => {
    const payload = req.body || {};
    const { documents, channels, isBulk } = payload;

    if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: 'Nenhum documento para enviar.' });
    }

    // Trava anti-duplicação: só um envio por vez pra esta sessão de WhatsApp.
    const lockKey = req.user || 'default';
    if (!acquireSendLock(lockKey, 'send-documents')) {
        return res.status(409).json({ error: 'Já existe um envio em andamento. Aguarde ele terminar antes de iniciar outro.' });
    }

    const total = new Set(documents.map((d) => d.companyId)).size;
    log(`[send-documents] ${documents.length} documento(s) p/ ${total} empresa(s). isBulk=${!!isBulk}. Channels: ${JSON.stringify(channels)}`);

    // ── envio em massa: responde na hora, processa em background, cliente acompanha o job
    if (isBulk) {
        const job = createJob({ user: req.user, total });
        const agentRaw = req.agentRaw;
        (async () => {
            try {
                await runSendDocuments({ user: req.user, agentRaw, payload, job });
                job.status = job.canceled ? 'canceled' : 'done';
            } catch (e) {
                log('[send-documents job] falha fatal', e);
                job.status = 'error';
                job.errors.push(e.message || 'Erro fatal no envio');
            } finally {
                job.finishedAt = Date.now();
                releaseSendLock(lockKey);
            }
        })();
        return res.status(202).json({ jobId: job.id, total });
    }

    // ── envio normal: síncrono (para o loop se a conexão do cliente cair)
    let aborted = false;
    res.on('close', () => { if (!res.writableFinished) aborted = true; });
    try {
        const r = await runSendDocuments({
            user: req.user, agentRaw: req.agentRaw, payload,
            shouldStop: () => aborted,
        });
        res.json({ success: true, sent: r.sent, skipped: r.skipped, sentIds: r.sentIds, errors: r.errors, aborted: r.aborted });
    } catch (fatal) {
        log('[send-documents] Falha fatal', fatal);
        if (!res.headersSent) res.status(500).json({ error: fatal.message || 'Erro no envio' });
    } finally {
        releaseSendLock(lockKey);
    }
});

// progresso de um envio em massa
router.get('/send-documents/status/:jobId', requirePermission('documents','view'), (req, res) => {
    const job = jobSnapshot(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Envio não encontrado (pode ter expirado ou o servidor reiniciou).' });
    res.json(job);
});

// cancela o restante de um envio em massa (o que já saiu não volta)
router.post('/send-documents/cancel/:jobId', requirePermission('documents','edit'), (req, res) => {
    const ok = cancelJob(req.params.jobId, req.user);
    if (!ok) return res.status(404).json({ error: 'Envio não encontrado.' });
    res.json({ success: true });
});

router.get('/recent-sends', requirePermission('documents','view'), async (req, res) => {
    try {
        res.json(await getDb(req.user).prepare("SELECT * FROM sent_logs ORDER BY id DESC LIMIT 3").all());
    } catch (err) {
        res.json([]);
    }
});

router.get('/file-gallery', authenticateToken, requirePermission('documents','view'), async (req, res) => {
    try {
        res.json(await getDb(req.user).prepare("SELECT * FROM file_gallery ORDER BY timestamp DESC").all());
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

router.delete('/file-gallery/:id', authenticateToken, requirePermission('documents','edit'), async (req, res) => {
    const db = getDb(req.user);
    try {
        const row = await db.prepare("SELECT serverFilename FROM file_gallery WHERE id = ?").get(req.params.id);
        if (row && row.serverFilename) {
            try {
                fs.unlinkSync(path.join(UPLOADS_DIR, row.serverFilename));
            } catch(e) {}
        }
        await db.prepare("DELETE FROM file_gallery WHERE id = ?").run(req.params.id);
        res.json({success: true});
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

router.get('/file-gallery/download/:id', authenticateToken, requirePermission('documents','view'), async (req, res) => {
    const db = getDb(req.user);
    try {
        const row = await db.prepare("SELECT serverFilename, originalName, mimeType FROM file_gallery WHERE id = ?").get(req.params.id);
        if (!row || !row.serverFilename) return res.status(404).send('Not found');
        const file = path.join(UPLOADS_DIR, row.serverFilename);
        if(!fs.existsSync(file)) return res.status(404).send('File not found on disk');
        res.download(file, row.originalName);
    } catch (err) {
        res.status(500).send('Error');
    }
});

router.get('/file-gallery/view/:id', authenticateToken, requirePermission('documents','view'), async (req, res) => {
    const db = getDb(req.user);
    try {
        const row = await db.prepare(`SELECT serverFilename, originalName, mimeType FROM file_gallery WHERE id = ?`).get(req.params.id);
        if (!row || !row.serverFilename) return res.status(404).send('Not found');

        const filePath = path.join(UPLOADS_DIR, row.serverFilename);
        if (!fs.existsSync(filePath)) return res.status(404).send('File not found on disk');

        res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.originalName)}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        res.status(500).send('Error');
    }
});

export default router;
