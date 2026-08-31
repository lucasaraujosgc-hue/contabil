import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { getWaClientWrapper, MessageMedia, safeSendMessage } from './whatsappService.js';
import {
    emailTransporter, saveToImapSentFolder, buildEmailHtml,
    processMessageVars, resolveFromAddress,
} from './emailService.js';
import { wasRecentlySent, markSent } from './sendLock.js';

const waTextKey = (chatId, body) => `${chatId}|txt|${crypto.createHash('sha1').update(body || '').digest('hex')}`;
const waMediaKey = (chatId, name, len) => `${chatId}|media|${name}|${len}`;

// Um envio de WhatsApp não deve travar o lote inteiro se o Puppeteer congelar.
const SEND_TIMEOUT_MS = 40 * 1000;
const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} após ${ms / 1000}s`)), ms)),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Job store — em memória, por processo (igual à trava). Sobrevive a requisições,
// não a restart. O que foi entregue de fato fica em sent_logs / document_status.
// ─────────────────────────────────────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

export function createJob({ user, total }) {
    const id = crypto.randomUUID();
    const job = {
        id, user,
        status: 'running',        // running | done | canceled | error
        total, done: 0, sent: 0, skipped: 0,
        errors: [], sentIds: [],
        currentName: null,
        canceled: false,
        startedAt: Date.now(), finishedAt: null,
    };
    jobs.set(id, job);
    sweep();
    return job;
}

export function jobSnapshot(id) {
    const j = jobs.get(id);
    if (!j) return null;
    return {
        id: j.id, status: j.status, total: j.total, done: j.done,
        sent: j.sent, skipped: j.skipped, errors: j.errors, sentIds: j.sentIds,
        currentName: j.currentName, startedAt: j.startedAt, finishedAt: j.finishedAt,
    };
}

export function cancelJob(id, user) {
    const j = jobs.get(id);
    if (!j || (user && j.user !== user)) return false;
    if (j.status === 'running') j.canceled = true;
    return true;
}

function sweep() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, j] of jobs) if (j.finishedAt && j.finishedAt < cutoff) jobs.delete(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo do envio. Usado pelo modo síncrono (envio normal) e pelo job (massa).
//   payload  = { documents, subject, messageBody, channels, emailSignature,
//                whatsappTemplate, whatsappFileSignature, isBulk }
//   job      = objeto de createJob() ou null
//   shouldStop() = aborta o loop (conexão do cliente caiu, no modo síncrono)
// ─────────────────────────────────────────────────────────────────────────────
export async function runSendDocuments({ user, agentRaw, payload, job = null, shouldStop = () => false }) {
    const {
        documents, subject, messageBody, channels,
        emailSignature, whatsappTemplate, whatsappFileSignature, isBulk,
    } = payload;

    const db = getDb(user);
    const waWrapper = getWaClientWrapper(user);
    const client = waWrapper.client;
    const clientReady = waWrapper.status === 'connected';
    if (channels.whatsapp && !clientReady) {
        log('[send-documents] AVISO: envio via WhatsApp pedido, mas cliente não está conectado.');
    }

    const result = { sent: 0, skipped: 0, sentIds: [], errors: [], aborted: false };
    const whatsappDone = new Set();

    const docsByCompany = documents.reduce((acc, d) => {
        (acc[d.companyId] = acc[d.companyId] || []).push(d);
        return acc;
    }, {});
    const companyIds = Object.keys(docsByCompany);

    for (const companyId of companyIds) {
        if (shouldStop() || job?.canceled) {
            result.aborted = true;
            log('[send-documents] interrompido (conexão caiu ou cancelado) — parando o restante');
            break;
        }
        const companyDocs = docsByCompany[companyId];

        try {
            const company = await db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
            if (!company) { result.errors.push(`Empresa ID ${companyId} não encontrada.`); continue; }
            if (job) job.currentName = company.name;

            const sortedDocs = [...companyDocs].sort((a, b) => {
                const da = a.dueDate ? a.dueDate.split('/').reverse().join('') : '99999999';
                const dbb = b.dueDate ? b.dueDate.split('/').reverse().join('') : '99999999';
                return da.localeCompare(dbb);
            });

            const validAttachments = [];
            for (const doc of sortedDocs) {
                if (doc.serverFilename) {
                    const fp = path.join(UPLOADS_DIR, doc.serverFilename);
                    if (fs.existsSync(fp)) {
                        validAttachments.push({ filename: doc.docName, path: fp, contentType: 'application/pdf', docData: doc });
                    } else {
                        log(`[send-documents] arquivo físico não encontrado: ${fp}`);
                        result.errors.push(`Arquivo sumiu do servidor: ${doc.docName}`);
                    }
                }
            }

            const processedMessageBody = processMessageVars(messageBody, company);

            // ── e-mail ──────────────────────────────────────────────────────
            if (channels.email && company.email) {
                try {
                    const finalHtml = buildEmailHtml(processedMessageBody, companyDocs, emailSignature);
                    const finalSubject = `${subject} - Competência: ${companyDocs[0].competence || 'N/A'}`;
                    const emailList = company.email.split(',').map((e) => e.trim()).filter(Boolean);
                    const mainEmail = emailList[0];
                    const ccEmails = emailList.slice(1).join(', ');
                    if (mainEmail) {
                        const mailOptions = {
                            from: resolveFromAddress(agentRaw),
                            to: mainEmail,
                            cc: ccEmails,
                            subject: finalSubject,
                            html: finalHtml,
                            attachments: validAttachments.map((a) => ({ filename: a.filename, path: a.path, contentType: a.contentType })),
                        };
                        await emailTransporter.sendMail(mailOptions);
                        await saveToImapSentFolder(mailOptions).catch((err) => log('[Email] Falha ao salvar no IMAP', err));
                        log(`[Email] Enviado para ${company.name} (${mainEmail})`);
                    }
                } catch (e) {
                    log(`[Email] Erro envio ${company.name}`, e);
                    result.errors.push(`Erro Email ${company.name}: ${e.message}`);
                }
            }

            // ── whatsapp ────────────────────────────────────────────────────
            let number = company.whatsapp ? company.whatsapp.replace(/\D/g, '') : '';
            if (number && !number.startsWith('55')) number = '55' + number;
            const chatId = number ? `${number}@c.us` : '';

            if (channels.whatsapp && chatId && clientReady && whatsappDone.has(chatId)) {
                log(`[send-documents] ${chatId} já atendido nesta execução — ignorando duplicata`);
            } else if (channels.whatsapp && chatId && clientReady) {
                whatsappDone.add(chatId);
                try {
                    const listaArquivos = validAttachments.map((att) =>
                        `• ${att.docData.docName} (${att.docData.category || 'Anexo'}, Venc: ${att.docData.dueDate || 'N/A'})`
                    ).join('\n');
                    const whatsappSignature = isBulk ? (whatsappFileSignature || '') : (whatsappTemplate || '');
                    let mensagemCompleta = processedMessageBody;
                    if (listaArquivos) mensagemCompleta += `\n\n*Arquivos enviados:*\n${listaArquivos}`;
                    mensagemCompleta += `\n\n${whatsappSignature}`;

                    const txtKey = waTextKey(chatId, mensagemCompleta);
                    if (wasRecentlySent(txtKey)) {
                        result.skipped++;
                        log(`[send-documents] texto idêntico já enviado p/ ${chatId} nos últimos 10min — ignorando`);
                    } else {
                        await withTimeout(safeSendMessage(client, chatId, mensagemCompleta), SEND_TIMEOUT_MS, `texto ${chatId}`);
                        markSent(txtKey);
                    }

                    for (const att of validAttachments) {
                        try {
                            const fileData = fs.readFileSync(att.path).toString('base64');
                            const mKey = waMediaKey(chatId, att.filename, fileData.length);
                            if (wasRecentlySent(mKey)) { result.skipped++; continue; }
                            const media = new MessageMedia(att.contentType, fileData, att.filename);
                            await withTimeout(safeSendMessage(client, chatId, media), SEND_TIMEOUT_MS, `mídia ${att.filename}`);
                            markSent(mKey);
                            await new Promise((r) => setTimeout(r, 3000));
                        } catch (mediaErr) {
                            log(`[WhatsApp] Erro envio mídia ${att.filename}`, mediaErr);
                            result.errors.push(`Erro mídia WhatsApp (${att.filename}): ${mediaErr.message}`);
                        }
                    }
                } catch (e) {
                    log(`[WhatsApp] Erro envio ${company.name}`, e);
                    result.errors.push(`Erro Zap ${company.name}: ${e.message}`);
                }
            } else if (channels.whatsapp && !clientReady) {
                result.errors.push(`WhatsApp não conectado. Não foi possível enviar para ${company.name}`);
            }

            // ── logs / status ───────────────────────────────────────────────
            const sentAtIso = new Date().toISOString();
            for (const doc of companyDocs) {
                if (doc.category) {
                    await db.prepare(`INSERT INTO sent_logs (companyName, docName, category, sentAt, channels, status) VALUES (?, ?, ?, ?, ?, 'success')`)
                        .run(company.name, doc.docName, doc.category, sentAtIso, JSON.stringify(channels));
                    await db.prepare(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, 'sent') ON CONFLICT(companyId, category, competence) DO UPDATE SET status='sent'`)
                        .run(doc.companyId, doc.category, doc.competence);
                }
                if (doc.serverFilename) {
                    try {
                        const fp = path.join(UPLOADS_DIR, doc.serverFilename);
                        if (fs.existsSync(fp)) {
                            const stat = fs.statSync(fp);
                            await db.prepare(`INSERT INTO file_gallery (serverFilename, originalName, mimeType, size, contact, channel, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                                .run(doc.serverFilename, doc.docName, 'application/pdf', stat.size, company.name,
                                     channels.whatsapp ? (channels.email ? 'Email/WhatsApp' : 'WhatsApp') : 'Email', 'sent', new Date().toISOString());
                        }
                    } catch (e) { /* galeria é best-effort */ }
                }
                if (doc.id) result.sentIds.push(doc.id);
                result.sent++;
            }
        } catch (e) {
            log(`[send-documents] Falha geral empresa ${companyId}`, e);
            result.errors.push(`Falha geral empresa ${companyId}: ${e.message}`);
        } finally {
            if (job) {
                job.done++;
                job.sent = result.sent;
                job.skipped = result.skipped;
                job.errors = result.errors;
                job.sentIds = result.sentIds;
            }
        }
    }

    return result;
}
