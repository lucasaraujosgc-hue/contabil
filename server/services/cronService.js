import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { getWaClientWrapper, safeSendMessage, MessageMedia } from './whatsappService.js';
import { emailTransporter, saveToImapSentFolder, buildEmailHtml, processMessageVars, resolveFromAddress } from './emailService.js';
import { getAgentByUsername } from './agents.js';

// --- CRON JOB --- (extraído do server.js; lógica inalterada, só adaptado p/ Postgres async)
async function tick() {
    const envUsers = (process.env.USERS || '').split(',');
    for (const user of envUsers) {
        const db = getDb(user);
        if (!db) continue;

        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const brazilTime = new Date(utc - (3600000 * 3));
        const nowStr = brazilTime.toISOString().slice(0, 16);

        let rows;
        try {
            rows = await db.prepare("SELECT * FROM scheduled_messages WHERE active = 1 AND nextRun <= ?").all(nowStr);
        } catch (err) {
            continue;
        }

        if (!rows || rows.length === 0) continue;

        log(`[CRON ${user}] Executando ${rows.length} tarefas. Hora: ${nowStr}`);

        const waWrapper = getWaClientWrapper(user);
        const clientReady = waWrapper.status === 'connected';

        let settings = null;
        try {
            const settingsRow = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
            settings = settingsRow ? JSON.parse(settingsRow.settings) : null;
        } catch (e) {}

        for (const msg of rows) {
            try {
                // alias de e-mail de quem criou o agendamento (fallback: remetente do .env)
                let creatorAgent = null;
                if (msg.createdBy) {
                    try { creatorAgent = await getAgentByUsername(db, msg.createdBy); } catch (e) {}
                }

                if (msg.targetType === 'personal') {
                    if (clientReady) {
                        const FALLBACK_REMINDER_NUMBER = '557591167094';
                        const FALLBACK_REMINDER_LID = '105403295727623@lid';
                        let chatId;
                        if (settings?.dailySummaryNumber) {
                            let number = settings.dailySummaryNumber.replace(/\D/g, '');
                            if (!number.startsWith('55')) number = '55' + number;
                            chatId = `${number}@c.us`;
                        } else {
                            chatId = FALLBACK_REMINDER_LID;
                        }
                        try {
                            await safeSendMessage(waWrapper.client, chatId, `⏰ *Lembrete:* ${msg.message}`);
                            log(`[CRON] Lembrete pessoal enviado para ${chatId}`);
                        } catch (lidErr) {
                            log(`[CRON] Falha com LID, tentando número: ${lidErr.message}`);
                            const fallbackPhone = `${FALLBACK_REMINDER_NUMBER}@c.us`;
                            await safeSendMessage(waWrapper.client, fallbackPhone, `⏰ *Lembrete:* ${msg.message}`);
                            log(`[CRON] Lembrete enviado via telefone para ${fallbackPhone}`);
                        }
                    } else {
                        log(`[CRON] WhatsApp não conectado, lembrete pendente: ${msg.message}`);
                    }
                } else {
                    const channels = JSON.parse(msg.channels || '{}');
                    const selectedIds = JSON.parse(msg.selectedCompanyIds || '[]');

                    let targetCompanies = [];
                    if (msg.targetType === 'selected' && selectedIds.length > 0) {
                        const placeholders = selectedIds.map(() => '?').join(',');
                        targetCompanies = await db.prepare(`SELECT * FROM companies WHERE id IN (${placeholders})`).all(...selectedIds);
                    } else if (msg.targetType !== 'selected') {
                        const operator = msg.targetType === 'mei' ? '=' : '!=';
                        targetCompanies = await db.prepare(`SELECT * FROM companies WHERE type ${operator} 'MEI'`).all();
                    }

                    let specificDocs = [];
                    if (msg.documentsPayload) {
                        try { specificDocs = JSON.parse(msg.documentsPayload); } catch(e) { log('[CRON] Erro parse docs payload', e); }
                    }

                    for (const company of targetCompanies) {
                        let attachmentsToSend = [];
                        let companySpecificDocs = [];

                        if (specificDocs.length > 0) {
                            companySpecificDocs = specificDocs.filter(d => d.companyId === company.id);
                            if (companySpecificDocs.length === 0) continue;

                            for (const doc of companySpecificDocs) {
                                 if (doc.serverFilename) {
                                     const p = path.join(UPLOADS_DIR, doc.serverFilename);
                                     if (fs.existsSync(p)) {
                                         attachmentsToSend.push({ filename: doc.docName, path: p, contentType: 'application/pdf', docData: doc });
                                     }
                                 }
                            }
                        } else if (msg.attachmentFilename) {
                            const p = path.join(UPLOADS_DIR, msg.attachmentFilename);
                            if (fs.existsSync(p)) {
                                attachmentsToSend.push({ filename: msg.attachmentOriginalName, path: p, contentType: 'application/pdf' });
                            }
                        }

                        const processedMessage = processMessageVars(msg.message, company);
                        const processedTitle = processMessageVars(msg.title, company);

                        if (channels.email && company.email) {
                           try {
                                const htmlContent = specificDocs.length > 0
                                ? buildEmailHtml(processedMessage, companySpecificDocs, settings?.emailSignature)
                                : buildEmailHtml(processedMessage, [], settings?.emailSignature);

                                const emailList = company.email.split(',').map(e => e.trim()).filter(e => e);
                                const mainEmail = emailList[0];
                                const ccEmails = emailList.slice(1).join(', ');

                                if (mainEmail) {
                                    const fromAddress = resolveFromAddress(creatorAgent);

                                    const mailOptions = {
                                        from: fromAddress,
                                        to: mainEmail,
                                        cc: ccEmails,
                                        subject: processedTitle,
                                        html: htmlContent,
                                        attachments: attachmentsToSend.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType }))
                                    };

                                    await emailTransporter.sendMail(mailOptions);
                                    await saveToImapSentFolder(mailOptions).catch(err =>
                                        log('[CRON] Falha ao salvar no IMAP', err)
                                    );
                                }
                           } catch(e) { log(`[CRON] Erro email ${company.name}`, e); }
                        }

                        if (channels.whatsapp && company.whatsapp && clientReady) {
                            try {
                                let number = company.whatsapp.replace(/\D/g, '');
                                if (!number.startsWith('55')) number = '55' + number;
                                const chatId = `${number}@c.us`;

                                let waBody = `*${processedTitle}*\n\n${processedMessage}`;

                                if (specificDocs.length > 0) {
                                    const listaArquivos = attachmentsToSend.map(att =>
                                        `• ${att.docData?.docName || att.filename} (${att.docData?.category || 'Anexo'}, Venc: ${att.docData?.dueDate || 'N/A'})`
                                    ).join('\n');
                                    waBody += `\n\n*Arquivos enviados:*\n${listaArquivos}`;
                                } else if (attachmentsToSend.length > 0) {
                                    waBody += `\n\n*Arquivo enviado:* ${attachmentsToSend[0].filename}`;
                                }

                                const whatsappSignature = settings?.whatsappFileSignature || '';
                                waBody += `\n\n${whatsappSignature}`;

                                await safeSendMessage(waWrapper.client, chatId, waBody);

                                for (const att of attachmentsToSend) {
                                    try {
                                        const fileData = fs.readFileSync(att.path).toString('base64');
                                        const media = new MessageMedia(att.contentType, fileData, att.filename);
                                        await safeSendMessage(waWrapper.client, chatId, media);
                                        await new Promise(r => setTimeout(r, 3000));
                                    } catch (err) {
                                        log(`[CRON] Erro media zap ${att.filename}`, err);
                                    }
                                }
                            } catch(e) { log(`[CRON] Erro zap ${company.name}`, e); }
                        }

                        if (companySpecificDocs.length > 0) {
                            for (const doc of companySpecificDocs) {
                                if (doc.category) {
                                    await db.prepare(`INSERT INTO sent_logs (companyName, docName, category, sentAt, channels, status) VALUES (?, ?, ?, datetime('now', 'localtime'), ?, 'success')`)
                                        .run(company.name, doc.docName, doc.category, JSON.stringify(channels));

                                    await db.prepare(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, 'sent') ON CONFLICT(companyId, category, competence) DO UPDATE SET status='sent'`)
                                        .run(doc.companyId, doc.category, doc.competence);
                                }
                            }
                        }
                    }
                }

                if (msg.recurrence === 'unico') {
                    await db.prepare("UPDATE scheduled_messages SET active = 0 WHERE id = ?").run(msg.id);
                } else {
                    const nextDate = new Date(msg.nextRun);
                    if (msg.recurrence === 'diaria') nextDate.setDate(nextDate.getDate() + 1);
                    else if (msg.recurrence === 'semanal') nextDate.setDate(nextDate.getDate() + 7);
                    else if (msg.recurrence === 'mensal') nextDate.setMonth(nextDate.getMonth() + 1);
                    else if (msg.recurrence === 'trimestral') nextDate.setMonth(nextDate.getMonth() + 3);
                    else if (msg.recurrence === 'anual') nextDate.setFullYear(nextDate.getFullYear() + 1);

                    const nextRunStr = nextDate.toISOString().slice(0, 16);
                    await db.prepare("UPDATE scheduled_messages SET nextRun = ? WHERE id = ?").run(nextRunStr, msg.id);
                }
            } catch(e) {
                log(`[CRON] Erro crítico processando msg ID ${msg.id}`, e);
            }
        }
    }
}

export function startCron() {
    setInterval(() => { tick().catch((e) => log('[CRON] erro no tick', e)); }, 60000);
}
