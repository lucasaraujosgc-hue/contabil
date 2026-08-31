import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { waClients, broadcastWaEvent } from '../state/waState.js';
import { touchConversation } from './conversations.js';

export { MessageMedia };

// --- HELPER: Puppeteer Lock Cleaner ---
const cleanPuppeteerLocks = (dir) => {
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    if (fs.existsSync(dir)) {
        locks.forEach(lock => {
            const lockPath = path.join(dir, lock);
            if (fs.existsSync(lockPath)) {
                try {
                    fs.unlinkSync(lockPath);
                    log(`[Puppeteer Fix] Trava removida: ${lockPath}`);
                } catch (e) {}
            }
        });
        const defaultDir = path.join(dir, 'Default');
        if (fs.existsSync(defaultDir)) {
             locks.forEach(lock => {
                const lockPath = path.join(defaultDir, lock);
                if (fs.existsSync(lockPath)) {
                    try { fs.unlinkSync(lockPath); } catch (e) {}
                }
            });
        }
    }
};

// --- HELPER: Robust WhatsApp Send ---
export const safeSendMessage = async (client, chatId, content, options = {}) => {
    log(`[WhatsApp] Tentando enviar mensagem para: ${chatId}`);
    try {
        if (!client) throw new Error("Client é null");

        const safeOptions = { 
            ...options, 
            sendSeen: false 
        };

        let finalChatId = chatId;
        
        if (!finalChatId.includes('@')) {
             if (/^\d+$/.test(finalChatId)) {
                 finalChatId = `${finalChatId}@c.us`;
             } else {
                 throw new Error("ChatId mal formatado: " + chatId);
             }
        }

        try {
            if (finalChatId.endsWith('@c.us')) {
                const numberPart = finalChatId.replace('@c.us', '').replace(/\D/g, '');
                const contactId = await client.getNumberId(numberPart);
                
                if (contactId && contactId._serialized) {
                    finalChatId = contactId._serialized;
                }
            }
        } catch (idErr) {
            log(`[WhatsApp] Erro não bloqueante ao resolver getNumberId: ${idErr.message}`);
        }

        try {
            const chat = await client.getChatById(finalChatId);
            const msg = await chat.sendMessage(content, safeOptions);
            return msg;
        } catch (chatError) {
            const msg = await client.sendMessage(finalChatId, content, safeOptions);
            return msg;
        }

    } catch (error) {
        log(`[WhatsApp] FALHA CRÍTICA NO ENVIO para ${chatId}`, error);
        throw error;
    }
};

// --- HELPER: Salvar mensagem(ns) no banco ---
const INSERT_WA_MESSAGE =
    `INSERT INTO whatsapp_messages
       (id, chatId, sender, timestamp, body, fromMe, hasMedia, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`;

export const saveMessageToDb = async (db, { id, chatId, sender, timestamp, body, fromMe, hasMedia, type }) => {
    if (!db || !id || !chatId) return;
    try {
        await db.prepare(INSERT_WA_MESSAGE).run(
            id, chatId, sender || '', timestamp || 0, body || '',
            fromMe ? 1 : 0, hasMedia ? 1 : 0, type || 'chat'
        );
    } catch (err) {
        log(`[DB] Erro ao salvar mensagem ${id}: ${err.message}`);
    }
};

export const saveMessagesToDb = async (db, messages) => {
    if (!db || !messages?.length) return;
    for (const m of messages) {
        try {
            await db.prepare(INSERT_WA_MESSAGE).run(
                m.id, m.chatId, m.sender || '', m.timestamp || 0,
                m.body || '', m.fromMe ? 1 : 0, m.hasMedia ? 1 : 0, m.type || 'chat'
            );
        } catch (err) {
            log(`[DB] Erro ao salvar mensagem ${m.id}: ${err.message}`);
        }
    }
};

// --- HELPER: upsertContactCache ---
export const upsertContactCache = async (db, contactId, contactName, phoneNumber = null) => {
    if (!db || !contactId || !contactName) return;
    try {
        await db.prepare(
            `INSERT INTO whatsapp_contacts (contact_id, name, phone_number, last_seen)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (contact_id) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, whatsapp_contacts.name),
             phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_contacts.phone_number),
             last_seen = CURRENT_TIMESTAMP`
        ).run(contactId, contactName, phoneNumber);
    } catch (err) {
        log(`[DB] Erro upsert contato ${contactId}: ${err.message}`);
    }
};

// --- MULTI-TENANCY: WhatsApp client wrapper ---
export const getWaClientWrapper = (username) => {
    if (!username) return null;
    
    if (!waClients[username]) {
        log(`[WhatsApp Init] Inicializando cliente para usuário: ${username}`);
        
        waClients[username] = {
            client: null,
            qr: null,
            status: 'disconnected',
            info: null,
            sseClients: []
        };

        const authPath = path.join(DATA_DIR, `whatsapp_auth_${username}`);
        if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

        const sessionPath = path.join(authPath, `session-${username}`);
        cleanPuppeteerLocks(sessionPath);

        const puppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        
        // WA_WEB_VERSION permite travar a versão do WhatsApp Web usada pelo Puppeteer.
        // Isso evita que uma atualização recente do WhatsApp Web quebre o whatsapp-web.js
        // (ex.: erros "Evaluation failed" no getChats/getChatModel).
        // Defina no .env, ex: WA_WEB_VERSION=2.2412.54
        // Lista de versões disponíveis: https://github.com/wppconnect-team/wa-version/tree/main/html
        const webVersionCache = process.env.WA_WEB_VERSION
            ? {
                type: 'remote',
                remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${process.env.WA_WEB_VERSION}.html`,
              }
            : { type: 'none' }; // 'none' = usa a versão embutida na própria WhatsApp Web ao carregar, sem cache

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: username, dataPath: authPath }), 
            webVersionCache,
            puppeteer: {
                headless: true,
                executablePath: puppeteerExecutablePath,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', 
                    '--disable-accelerated-2d-canvas', 
                    '--no-first-run', 
                    '--no-zygote', 
                    '--disable-gpu', 
                    '--disable-software-rasterizer',
                    '--single-process'
                ],
            }
        });

        // ============================================================
        // SEÇÃO 2 — handler 'message' (mensagens RECEBIDAS)
        // ============================================================
        client.on('message', async (msg) => {
            if (msg.from.includes('@g.us') || msg.to.includes('@g.us') || msg.isStatus || (msg.id && msg.id.remote && msg.id.remote.includes('@g.us'))) {
                return;
            }

            const sender = msg.from;
            const chatId = msg.from;
            log(`[WhatsApp Inbound] Mensagem recebida de: ${sender} | Body: ${msg.body?.substring(0, 30)}...`);

            let contactName = null;
            try {
                const contact = await msg.getContact();
                contactName = contact.name || contact.pushname || contact.number || sender;
            } catch (e) { contactName = sender; }

            const db = getDb(username);
            if (db) {
                const phoneNumber = sender.includes('@c.us') ? sender.replace('@c.us', '') : null;
                upsertContactCache(db, sender, contactName, phoneNumber);
            }

            const msgPayload = {
                id: msg.id._serialized,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                type: msg.type,
                fromMe: false,
                chatId: chatId,
                contactName: contactName
            };
            broadcastWaEvent(username, 'whatsapp_message', msgPayload);

            if (db) {
                saveMessageToDb(db, {
                    id: msg.id._serialized,
                    chatId,
                    sender: msg.from,
                    timestamp: msg.timestamp,
                    body: msg.body || '',
                    fromMe: false,
                    hasMedia: msg.hasMedia,
                    type: msg.type
                });
                try {
                    await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(contactName, msg.id._serialized);
                } catch (e) {}
                try {
                    const conv = await touchConversation(db, chatId, { fromMe: false, ts: msg.timestamp, name: contactName });
                    if (conv) broadcastWaEvent(username, 'conversation_update', conv);
                } catch (e) { log(`[conv] touch inbound ${chatId}: ${e.message}`); }
            }

            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const originalName = media.filename || ('whatsapp_media_' + msg.timestamp + '.' + (media.mimetype.split('/')[1] || '').split(';')[0] || 'bin');
                        const serverFilename = Date.now() + '-' + originalName.replace(/[^a-zA-Z0-9.]/g, '_');
                        const buffer = Buffer.from(media.data, 'base64');
                        fs.writeFileSync(path.join(UPLOADS_DIR, serverFilename), buffer);
                        
                        if(db) {
                            await db.prepare(
                                'INSERT INTO file_gallery (serverFilename, originalName, mimeType, size, contact, channel, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                            ).run(serverFilename, originalName, media.mimetype, buffer.length, msg.from, 'whatsapp', 'received', new Date().toISOString());
                        }
                    }
                } catch(e) {
                    log(`[WhatsApp Inbound] Erro ao baixar media auto: ${e.message}`);
                }
            }

            try {
                const settingsRow = db ? await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get() : null;
                const settings = settingsRow ? JSON.parse(settingsRow.settings) : null;

                const FALLBACK_AUTHORIZED_NUMBER = '557591167094';
                const FALLBACK_AUTHORIZED_LID = '105403295727623@lid';
                const LEGACY_LID = '140368205074641@lid';

                const isLid = msg.from.endsWith('@lid');
                let isAuthorized = false;

                if (isLid) {
                    isAuthorized = (msg.from === FALLBACK_AUTHORIZED_LID || msg.from === LEGACY_LID);
                    if (!isAuthorized && settings?.authorizedLid) {
                        isAuthorized = (msg.from === settings.authorizedLid);
                    }
                } else {
                    const senderNumber = msg.from.replace('@c.us', '').replace(/\D/g, '');
                    if (senderNumber === FALLBACK_AUTHORIZED_NUMBER.replace(/\D/g, '')) {
                        isAuthorized = true;
                    }
                    if (!isAuthorized && settings?.dailySummaryNumber) {
                        const authorizedNumber = settings.dailySummaryNumber.replace(/\D/g, '');
                        isAuthorized = senderNumber.endsWith(authorizedNumber);
                    }
                }

                if (!isAuthorized) {
                    log(`[AI Trigger] Acesso negado para: ${msg.from}`);
                    return;
                }

                if (settings.aiEnabled === false) {
                    log(`[AI Trigger] IA está desativada nas configurações.`);
                    return;
                }

                log(`[AI Trigger] ACESSO PERMITIDO! Iniciando processamento IA...`);

                let mediaPart = null;
                let textContent = msg.body;

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            mediaPart = {
                                inlineData: {
                                    mimeType: media.mimetype,
                                    data: media.data
                                }
                            };
                            if (media.mimetype.startsWith('audio/')) {
                                textContent = "Por favor, analise este áudio. " + (msg.body || "");
                            } else {
                                textContent += " [Mídia anexa]";
                            }
                        }
                    } catch (mediaErr) {
                        log("Erro download media", mediaErr);
                    }
                }

                const { processAI } = await import('./aiService.js');
                const response = await processAI(username, textContent, mediaPart);
                await safeSendMessage(client, msg.from, response);

            } catch (e) {
                log("Erro no handler de mensagem IA", e);
            }
        });

        // ============================================================
        // SEÇÃO 3 — handler 'message_create' (mensagens ENVIADAS)
        // ============================================================
        client.on('message_create', async (msg) => {
            if (msg.fromMe) {
                const chatId = msg.to;
                let contactName = null;
                try {
                    const contact = await msg.getContact();
                    contactName = contact.name || contact.pushname || contact.number || chatId;
                } catch (e) { contactName = chatId; }

                const db = getDb(username);
                if (db) {
                    const phoneNumber = chatId.includes('@c.us') ? chatId.replace('@c.us', '') : null;
                    upsertContactCache(db, chatId, contactName, phoneNumber);
                }

                broadcastWaEvent(username, 'whatsapp_message', {
                    id: msg.id._serialized,
                    from: msg.from,
                    to: msg.to,
                    body: msg.body,
                    timestamp: msg.timestamp,
                    hasMedia: msg.hasMedia,
                    type: msg.type,
                    fromMe: true,
                    chatId: chatId,
                    contactName: contactName
                });

                if (db) {
                    saveMessageToDb(db, {
                        id: msg.id._serialized,
                        chatId,
                        sender: msg.from,
                        timestamp: msg.timestamp,
                        body: msg.body || '',
                        fromMe: true,
                        hasMedia: msg.hasMedia,
                        type: msg.type
                    });
                    try {
                        await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(contactName, msg.id._serialized);
                    } catch (e) {}
                    try {
                        const conv = await touchConversation(db, chatId, { fromMe: true, ts: msg.timestamp, name: contactName });
                        if (conv) broadcastWaEvent(username, 'conversation_update', conv);
                    } catch (e) { log(`[conv] touch outbound ${chatId}: ${e.message}`); }
                }
            }
        });

        client.on('qr', (qr) => {
            log(`[WhatsApp Event] QR Code gerado para ${username}`);
            QRCode.toDataURL(qr, (err, url) => { 
                if (err) log(`[WhatsApp Event] Erro QR`, err);
                waClients[username].qr = url; 
                waClients[username].status = 'generating_qr';
            }); 
        });
        
        client.on('ready', async () => { 
            log(`[WhatsApp Event] CLIENTE PRONTO (${username})`);
            waClients[username].status = 'connected';
            waClients[username].qr = null;
            waClients[username].info = client.info;

            // ============================================================
            // FIX 1 — Popular cache de contatos proativamente ao conectar
            // ============================================================
            try {
                const db = getDb(username);
                if (db) {
                    const chats = await client.getChats();
                    let seeded = 0;
                    for (const chat of chats) {
                        if (chat.isGroup) continue;
                        const chatId = chat.id._serialized;
                        if (!chatId) continue;
                        const isLid = chatId.includes('@lid');
                        let resolvedId = chatId;
                        let phone = isLid ? null : chatId.replace('@c.us', '').replace(/\D/g, '');

                        if (!isLid && phone) {
                            try {
                                const numberId = await client.getNumberId(phone);
                                if (numberId && numberId._serialized) {
                                    resolvedId = numberId._serialized;
                                }
                            } catch (_) {}
                        }

                        const contactName = chat.name || chat.id.user || resolvedId;
                        upsertContactCache(db, resolvedId, contactName, phone);
                        seeded++;
                    }
                    log(`[WhatsApp Cache] ${seeded} contatos populados no cache ao conectar.`);
                }
            } catch (e) {
                log(`[WhatsApp Cache] Erro ao popular cache na inicialização: ${e.message}`);
            }
        });
        
        client.on('authenticated', () => {
            log(`[WhatsApp Event] Autenticado (${username})`);
        });

        client.on('auth_failure', (msg) => {
            log(`[WhatsApp Event] FALHA DE AUTENTICAÇÃO (${username}): ${msg}`);
            waClients[username].status = 'error';
        });
        
        client.on('disconnected', (reason) => { 
            log(`[WhatsApp Event] Desconectado (${username}). Razão: ${reason}`);
            waClients[username].status = 'disconnected';
            waClients[username].info = null;
        });

        client.initialize().catch((err) => {
            log(`[WhatsApp Init] ERRO FATAL (${username})`, err);
            waClients[username].status = 'error';
        });
        
        waClients[username].client = client;
    }

    return waClients[username];
};

// --- LOGIC: Send Daily Summary Helper ---
export const sendDailySummaryToUser = async (user) => {
    const db = getDb(user);
    if (!db) return;

    const waWrapper = getWaClientWrapper(user);
    if (waWrapper.status !== 'connected') {
        return { success: false, message: 'WhatsApp desconectado' };
    }

    try {
        const settingsRow = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        if (!settingsRow) return { success: false, message: 'Configurações não encontradas' };
        
        const settings = JSON.parse(settingsRow.settings);
        if (!settings.dailySummaryNumber) return { success: false, message: 'Número para resumo não configurado' };

        const tasks = await db.prepare(
            `SELECT t.*, c.name as companyName FROM tasks t LEFT JOIN companies c ON t.companyId = c.id WHERE t.status != 'concluida'`
        ).all();

        if (!tasks || tasks.length === 0) return { success: true, message: 'Nenhuma tarefa pendente' };

        const priorityMap = { 'alta': 1, 'media': 2, 'baixa': 3 };
        const sortedTasks = tasks.sort((a, b) => (priorityMap[a.priority] || 99) - (priorityMap[b.priority] || 99));

        let message = `*📅 Resumo Diário de Tarefas*\n\nVocê tem *${sortedTasks.length}* tarefas pendentes.\n\n`;
        sortedTasks.forEach(task => {
            let icon = task.priority === 'alta' ? '🔴' : task.priority === 'media' ? '🟡' : '🔵';
            message += `${icon} *${task.title}*\n`;
            if (task.companyName) message += `   🏢 ${task.companyName}\n`;
            if (task.dueDate) message += `   📅 Vence: ${task.dueDate}\n`;
            message += `\n`;
        });
        message += `_Gerado automaticamente pelo Contábil Manager Pro_`;

        let number = settings.dailySummaryNumber.replace(/\D/g, '');
        if (!number.startsWith('55')) number = '55' + number;
        const chatId = `${number}@c.us`;
        
        await safeSendMessage(waWrapper.client, chatId, message);
        return { success: true, message: 'Enviado com sucesso' };
    } catch (sendErr) {
        log(`[Summary] Erro envio`, sendErr);
        return { success: false, message: 'Erro no envio do WhatsApp' };
    }
};
