import express from 'express';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { getWaClientWrapper, MessageMedia } from '../services/whatsappService.js';
import { emailTransporter, saveToImapSentFolder, buildEmailHtml, processMessageVars } from '../services/emailService.js';
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
    const { documents, subject, messageBody, channels, emailSignature, whatsappTemplate, whatsappFileSignature, isBulk } = req.body;
    
    log(`[API send-documents] Iniciando envio de ${documents.length} documentos. Channels: ${JSON.stringify(channels)}`);
    
    const db = getDb(req.user);
    const waWrapper = getWaClientWrapper(req.user);
    const client = waWrapper.client;
    const clientReady = waWrapper.status === 'connected';

    if (channels.whatsapp && !clientReady) {
        log(`[API send-documents] AVISO: Tentativa de envio via WhatsApp, mas cliente não está conectado.`);
    }

    let successCount = 0;
    let errors = [];
    let sentIds = [];

    const docsByCompany = documents.reduce((acc, doc) => {
        if (!acc[doc.companyId]) acc[doc.companyId] = [];
        acc[doc.companyId].push(doc);
        return acc;
    }, {});

    const companyIds = Object.keys(docsByCompany);

    for (const companyId of companyIds) {
        const companyDocs = docsByCompany[companyId];
        
        try {
            const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId);
            if (!company) { errors.push(`Empresa ID ${companyId} não encontrada.`); continue; }

            const sortedDocs = [...companyDocs].sort((a, b) => {
                const dateA = a.dueDate ? a.dueDate.split('/').reverse().join('') : '99999999';
                const dateB = b.dueDate ? b.dueDate.split('/').reverse().join('') : '99999999';
                return dateA.localeCompare(dateB);
            });

            const validAttachments = [];
            for (const doc of sortedDocs) {
                if (doc.serverFilename) {
                    const filePath = path.join(UPLOADS_DIR, doc.serverFilename);
                    if (fs.existsSync(filePath)) {
                        validAttachments.push({
                            filename: doc.docName,
                            path: filePath,
                            contentType: 'application/pdf',
                            docData: doc
                        });
                    } else {
                        log(`[API send-documents] Arquivo físico não encontrado: ${filePath}`);
                        errors.push(`Arquivo sumiu do servidor: ${doc.docName}`);
                    }
                }
            }

            const processedMessageBody = processMessageVars(messageBody, company);

            if (channels.email && company.email) {
                try {
                    const finalHtml = buildEmailHtml(processedMessageBody, companyDocs, emailSignature);
                    const finalSubject = `${subject} - Competência: ${companyDocs[0].competence || 'N/A'}`; 
                    
                    const emailList = company.email.split(',').map(e => e.trim()).filter(e => e);
                    const mainEmail = emailList[0];
                    const ccEmails = emailList.slice(1).join(', ');

                    if (mainEmail) {
                        const senderName = process.env.EMAIL_FROM_NAME || 'Contabilidade';
                        const senderEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER;
                        const fromAddress = `"${senderName}" <${senderEmail}>`;

                        const mailOptions = {
                            from: fromAddress,
                            to: mainEmail,
                            cc: ccEmails, 
                            subject: finalSubject,
                            html: finalHtml,
                            attachments: validAttachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType }))
                        };

                        await emailTransporter.sendMail(mailOptions);
                        await saveToImapSentFolder(mailOptions).catch(err => 
                            log('[Email] Falha ao salvar no IMAP', err)
                        );
                        log(`[Email] Enviado para ${company.name} (${mainEmail})`);
                    }
                } catch (e) { 
                    log(`[Email] Erro envio ${company.name}`, e);
                    errors.push(`Erro Email ${company.name}: ${e.message}`); 
                }
            }

            if (channels.whatsapp && company.whatsapp && clientReady) {
                try {
                    let number = company.whatsapp.replace(/\D/g, '');
                    if (!number.startsWith('55')) number = '55' + number;
                    const chatId = `${number}@c.us`;

                    const listaArquivos = validAttachments.map(att => 
                        `• ${att.docData.docName} (${att.docData.category || 'Anexo'}, Venc: ${att.docData.dueDate || 'N/A'})`
                    ).join('\n');
                    
                    const whatsappSignature = isBulk ? (whatsappFileSignature || "") : (whatsappTemplate || "");
                        
                    let mensagemCompleta = processedMessageBody;
                    
                    if (listaArquivos) {
                        mensagemCompleta += `\n\n*Arquivos enviados:*\n${listaArquivos}`;
                    }
                    
                    mensagemCompleta += `\n\n${whatsappSignature}`;

                    await safeSendMessage(client, chatId, mensagemCompleta);

                    for (const att of validAttachments) {
                        try {
                            const fileData = fs.readFileSync(att.path).toString('base64');
                            const media = new MessageMedia(att.contentType, fileData, att.filename);
                            
                            await safeSendMessage(client, chatId, media);
                            
                            await new Promise(r => setTimeout(r, 3000));
                        } catch (mediaErr) {
                            log(`[WhatsApp] Erro envio mídia ${att.filename}`, mediaErr);
                            errors.push(`Erro mídia WhatsApp (${att.filename}): ${mediaErr.message}`);
                        }
                    }
                } catch (e) { 
                    log(`[WhatsApp] Erro envio ${company.name}`, e);
                    errors.push(`Erro Zap ${company.name}: ${e.message}`); 
                }
            } else if (channels.whatsapp && !clientReady) {
                 errors.push(`WhatsApp não conectado. Não foi possível enviar para ${company.name}`);
            }

            for (const doc of companyDocs) {
                if (doc.category) { 
                    await db.prepare(`INSERT INTO sent_logs (companyName, docName, category, sentAt, channels, status) VALUES (?, ?, ?, datetime('now', 'localtime'), ?, 'success')`)
                        .run(company.name, doc.docName, doc.category, JSON.stringify(channels));
                    
                    await db.prepare(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, 'sent') ON CONFLICT(companyId, category, competence) DO UPDATE SET status='sent'`)
                        .run(doc.companyId, doc.category, doc.competence);
                }
                
                if (doc.serverFilename) {
                    try {
                        const filePath = path.join(UPLOADS_DIR, doc.serverFilename);
                        if (fs.existsSync(filePath)) {
                            const stat = fs.statSync(filePath);
                            await db.prepare(`INSERT INTO file_gallery (serverFilename, originalName, mimeType, size, contact, channel, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                                .run(doc.serverFilename, doc.docName, 'application/pdf', stat.size, company.name, channels.whatsapp ? (channels.email ? 'Email/WhatsApp' : 'WhatsApp') : 'Email', 'sent', new Date().toISOString());
                        }
                    } catch (e) {}
                }

                if (doc.id) sentIds.push(doc.id);
                successCount++;
            }
        } catch (e) { 
            log(`[API send-documents] Falha geral empresa ${companyId}`, e);
            errors.push(`Falha geral empresa ${companyId}: ${e.message}`); 
        }
    }
    
    res.json({ success: true, sent: successCount, sentIds, errors });
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
